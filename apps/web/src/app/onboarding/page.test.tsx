/**
 * Onboarding step machine — boundary + step-resolution tests (D106).
 *
 * Pins the load-bearing behaviors of the restructured auth boundary:
 *
 *   1. An UNAUTHED visitor sees the D107 promise screen (with the
 *      D228 trust copy) instead of being force-bounced to OAuth —
 *      the whole point of the U21 restructure.
 *   2. Promise → Connect is a local hop (step 2 explains scopes).
 *   3. An AUTHED user with a ready mailbox and no submitted picks
 *      resumes at step 4 (server-derived resume; the already-
 *      connected fast-path skips steps 1-3 honestly).
 *   4. The secondary-connect entry (`?mailbox=`) still renders the
 *      gate — not the step machine.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, type FetchStubHandler } from '@/test/fetch-stub';

const replace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/onboarding',
  useSearchParams: () => searchParams,
}));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const me401: FetchStubHandler = {
  method: 'GET',
  path: '/api/auth/me',
  respond: () => json({ message: 'unauthenticated' }, 401),
};

const meAuthed = (readiness: 'ready' | 'syncing'): FetchStubHandler => ({
  method: 'GET',
  path: '/api/auth/me',
  respond: () =>
    json({
      data: {
        user: { id: 'u1', email: 'a@b.com', workspaceId: 'w1' },
        mailboxes: [
          { id: 'mb1', email: 'a@b.com', status: 'active', connectedAt: null, readiness },
        ],
        activeMailboxId: 'mb1',
      },
    }),
});

const onboardingState = (over: Record<string, unknown> = {}): FetchStubHandler => ({
  method: 'GET',
  path: '/api/onboarding/state',
  respond: () =>
    json({
      data: {
        onboardedAt: null,
        skipped: false,
        presetPicks: null,
        presets: [
          {
            key: 'auto_archive_low_engagement',
            name: 'Auto-archive low-engagement',
            description: 'Archives mail from senders you almost never open.',
            verb: 'archive',
          },
        ],
        ...over,
      },
    }),
});

const syncStatus = (ready: boolean): FetchStubHandler => ({
  method: 'GET',
  path: '/api/v1/sync/status',
  respond: () =>
    json({
      data: {
        readiness_status: ready ? 'ready' : 'syncing',
        current_stage: ready ? 'ready' : 'fetching_metadata',
        progress_pct: ready ? 100 : 40,
        is_ready_for_triage: ready,
      },
    }),
});

const emptyRules: FetchStubHandler = {
  method: 'GET',
  path: '/api/autopilot/rules',
  respond: () => json({ data: [] }),
};

function renderPage() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <OnboardingPage />
    </QueryWrapper>,
  );
}

describe('onboarding page — pre-auth boundary (D107/D108)', () => {
  it('unauthed visitor sees the promise screen with the D228 trust copy — no OAuth bounce', async () => {
    installFetchStub([me401]);
    renderPage();

    expect(await screen.findByText('Control Gmail by sender, not by email.')).toBeInTheDocument();
    expect(screen.getByText('Full bodies fetched: 0')).toBeInTheDocument();
    // The banned pre-D228 phrasing must not exist anywhere on step 1.
    expect(screen.queryByText(/Bodies read: 0/)).not.toBeInTheDocument();
  });

  it('promise → connect is a local hop; step 2 explains access and data use', async () => {
    installFetchStub([me401]);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: /Connect Gmail/ }));
    expect(await screen.findByText('Connect your Gmail.')).toBeInTheDocument();
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Fetched during the scan')).toBeInTheDocument();
    expect(screen.getByText('Stored in DeclutrMail')).toBeInTheDocument();
    expect(screen.getByText('Actions you approve')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue to Google' })).toBeInTheDocument();
  });
});

describe('onboarding page — authed resume (D106 derivation)', () => {
  it('ready mailbox + no picks resumes at step 4 (steps 1-3 skipped honestly)', async () => {
    installFetchStub([meAuthed('ready'), onboardingState(), syncStatus(true), emptyRules]);
    renderPage();

    expect(await screen.findByText('Pick your starting rules.')).toBeInTheDocument();
    expect(screen.getByText('Auto-archive low-engagement')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue without rules' })).toBeInTheDocument();
  });

  it('syncing mailbox renders the strict gate at step 3 of 5', async () => {
    installFetchStub([meAuthed('syncing'), onboardingState(), syncStatus(false)]);
    renderPage();

    expect(await screen.findByText('Reading your inbox…')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 5 · One-time scan')).toBeInTheDocument();
  });

  it('onboarded user is redirected out to /senders', async () => {
    installFetchStub([
      meAuthed('ready'),
      onboardingState({ onboardedAt: '2026-06-11T00:00:00.000Z' }),
      syncStatus(true),
    ]);
    renderPage();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/senders'));
  });
});

describe('onboarding page — secondary connect entry (D116, unchanged)', () => {
  it('?mailbox= renders the gate without the 5-step counter', async () => {
    searchParams = new URLSearchParams('mailbox=mb2');
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () =>
          json({
            data: {
              user: { id: 'u1', email: 'a@b.com', workspaceId: 'w1' },
              mailboxes: [
                {
                  id: 'mb1',
                  email: 'a@b.com',
                  status: 'active',
                  connectedAt: null,
                  readiness: 'ready',
                },
                {
                  id: 'mb2',
                  email: 'c@d.com',
                  status: 'active',
                  connectedAt: null,
                  readiness: 'syncing',
                },
              ],
              activeMailboxId: 'mb1',
            },
          }),
      },
      syncStatus(false),
    ]);
    renderPage();

    expect(await screen.findByText('Reading your inbox…')).toBeInTheDocument();
    expect(screen.getByText('One-time scan')).toBeInTheDocument();
    expect(screen.queryByText(/Step 3 of 5/)).not.toBeInTheDocument();
    // Escape hatch back to the other active mailbox is offered.
    expect(screen.getByText(/a@b\.com/)).toBeInTheDocument();
  });
});
