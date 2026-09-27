/**
 * Tests for `QuietRoute` (U18 — D92/D95) — the live wiring:
 *
 *   - empty branch (no mailboxes connected)
 *   - one card per mailbox, hydrated from GET /api/mailboxes/:id/quiet-hours
 *   - the save flow fires PUT with the edited config and the cache
 *     adopts the server's post-save state (the "Quiet now" pill flips
 *     from the response, never optimistically)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { toast } from '@declutrmail/shared';
import userEvent from '@testing-library/user-event';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import type { Me } from '@/features/auth/api/use-me';
import { QuietRoute } from './quiet-screen';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

const MAILBOX_A = '11111111-1111-4111-8111-111111111111';
const MAILBOX_B = '22222222-2222-4222-8222-222222222222';

let me: Me;

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me }),
}));

function makeMe(mailboxes: Me['mailboxes']): Me {
  return {
    user: { id: 'u-1', email: 'a@b.com', workspaceId: 'ws-1', timezone: null },
    mailboxes,
    activeMailboxId: mailboxes[0]?.id ?? null,
    tier: 'pro',
    cleanupRemaining: null,
  };
}

const mailbox = (id: string, email: string): Me['mailboxes'][number] => ({
  id,
  email,
  status: 'active',
  connectedAt: '2026-06-01T00:00:00.000Z',
  readiness: 'ready',
});

const CONFIG = {
  enabled: true,
  startLocal: '22:00',
  endLocal: '06:00',
  timezone: 'Asia/Kolkata',
};

function jsonEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderRoute() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <QuietRoute />
    </QueryWrapper>,
  );
}

describe('QuietRoute', () => {
  beforeEach(() => {
    installFetchStub([]);
  });
  afterEach(() => {
    resetFetchStub();
    vi.mocked(toast).mockClear();
  });

  it('links only the active inbox to its Autopilot rules', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com'), mailbox(MAILBOX_B, 'b@b.com')]);
    installFetchStub(
      [MAILBOX_A, MAILBOX_B].map((id) => ({
        method: 'GET' as const,
        path: `/api/mailboxes/${id}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 2, endsAt: null }),
      })),
    );
    renderRoute();
    await screen.findByText(/Choose this inbox in the account menu/i);
    expect(screen.getAllByRole('link', { name: /Review Autopilot rules/i })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Review Autopilot rules/i })).toHaveAttribute(
      'href',
      '/autopilot',
    );
  });

  it('renders the empty state when no mailboxes are connected', () => {
    me = makeMe([]);
    renderRoute();
    expect(screen.getByText('No mailboxes connected')).toBeInTheDocument();
  });

  it('renders one hydrated card per mailbox', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com'), mailbox(MAILBOX_B, 'b@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 0, endsAt: null }),
      },
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_B}/quiet-hours`,
        respond: () => jsonEnvelope({ config: null, activeNow: false, heldCount: 0, endsAt: null }),
      },
    ]);

    renderRoute();

    expect(await screen.findByText('a@b.com')).toBeInTheDocument();
    expect(screen.getByText('b@b.com')).toBeInTheDocument();
    // Mailbox A is quiet right now; B has never been configured.
    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
    const starts = await screen.findAllByLabelText('Quiet window start');
    expect(starts[0]).toHaveValue('22:00');
  });

  it('saves through PUT and adopts the server state', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    let putBody: unknown = null;
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0, endsAt: null }),
      },
      {
        method: 'PUT',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: async (req) => {
          putBody = await req.json();
          return jsonEnvelope({ config: putBody, activeNow: true, heldCount: 0, endsAt: null });
        },
      },
    ]);

    renderRoute();
    const checkbox = await screen.findByRole('switch', { name: 'Quiet hours' });
    await userEvent.click(checkbox); // enabled: true → false (dirty)
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toEqual({ ...CONFIG, enabled: false });
    // Server said activeNow: true → the pill renders from the response.
    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
    // The save is confirmed in place, announced by a live region that
    // outlives the form's remount — not by a toast.
    expect(screen.getByRole('status', { name: 'Save status for a@b.com' })).toHaveTextContent(
      'Saved',
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('counts held actions and says when quiet ends, without promising a release then', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    const endsAt = '2026-07-15T05:00:00.000Z';
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 2, endsAt }),
      },
    ]);

    renderRoute();

    const summary = await screen.findByRole('status', { name: 'Quiet status for a@b.com' });
    expect(summary).toHaveTextContent(/\b2\b/);
    expect(summary).toHaveTextContent(/held/);
    // A rule's daily cap can hold some past the end, so the end is not a release time.
    expect(summary).not.toHaveTextContent(/until/);
    const time = summary.querySelector('time');
    expect(time).toHaveAttribute('datetime', endsAt);
    // The end is always under a day away: a time, no date.
    expect(time).toHaveTextContent('10:30');
    expect(time).not.toHaveTextContent('2026');
  });

  it('counts an indefinite quiet hold without inventing an end time', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 1, endsAt: null }),
      },
    ]);

    renderRoute();

    const summary = await screen.findByRole('status', { name: 'Quiet status for a@b.com' });
    expect(summary).toHaveTextContent(/\b1\b/);
    expect(summary).toHaveTextContent(/held/);
    expect(summary.querySelector('time')).toBeNull();
  });

  it('says only when quiet ends while nothing is held', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    const endsAt = '2026-07-15T05:00:00.000Z';
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 0, endsAt }),
      },
    ]);

    renderRoute();

    const summary = await screen.findByRole('status', { name: 'Quiet status for a@b.com' });
    expect(summary.querySelector('time')).toHaveAttribute('datetime', endsAt);
    expect(summary).not.toHaveTextContent(/Autopilot/);
    expect(screen.queryByRole('link', { name: /Autopilot rules/i })).not.toBeInTheDocument();
  });

  it('shows no quiet status while nothing is held and no end is known', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 0, endsAt: null }),
      },
    ]);

    renderRoute();

    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
    expect(
      screen.queryByRole('status', { name: 'Quiet status for a@b.com' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Autopilot action/)).not.toBeInTheDocument();
  });

  it('shows no quiet status while quiet is off', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: `/api/mailboxes/${MAILBOX_A}/quiet-hours`,
        respond: () =>
          jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 2, endsAt: null }),
      },
    ]);

    renderRoute();

    expect(await screen.findByLabelText('Quiet window start')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Quiet status for a@b.com' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Autopilot action/)).not.toBeInTheDocument();
  });
});
