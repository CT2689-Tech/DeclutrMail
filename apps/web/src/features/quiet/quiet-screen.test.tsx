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
import userEvent from '@testing-library/user-event';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import type { Me } from '@/features/auth/api/use-me';
import { QuietRoute } from './quiet-screen';

const MAILBOX_A = '11111111-1111-4111-8111-111111111111';
const MAILBOX_B = '22222222-2222-4222-8222-222222222222';

let me: Me;

vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({ me }),
}));

function makeMe(mailboxes: Me['mailboxes']): Me {
  return {
    user: { id: 'u-1', email: 'a@b.com', workspaceId: 'ws-1' },
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
    const checkbox = await screen.findByRole('checkbox', { name: 'Quiet hours on' });
    await userEvent.click(checkbox); // enabled: true → false (dirty)
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toEqual({ ...CONFIG, enabled: false });
    // Server said activeNow: true → the pill renders from the response.
    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
  });

  it('shows held actions and the scheduled quiet end', async () => {
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

    const summary = await screen.findByRole('status');
    expect(summary).toHaveTextContent('2 Autopilot actions are held.');
    expect(summary).toHaveTextContent('Autopilot will run them afterward.');
    expect(summary.querySelector('time')).toHaveAttribute('datetime', endsAt);
  });

  it('explains an indefinite quiet hold without inventing a release time', async () => {
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

    expect(await screen.findByRole('status')).toHaveTextContent(
      '1 Autopilot action is held. No automatic release time is available; it will stay held until quiet ends.',
    );
  });

  it('shows the active zero-held state', async () => {
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

    const summary = await screen.findByRole('status');
    expect(summary).toHaveTextContent('No Autopilot actions are held. Quiet ends at');
    expect(summary.querySelector('time')).toHaveAttribute('datetime', endsAt);
  });

  it('does not attribute pending actions to quiet when quiet is off', async () => {
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

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Quiet is off. 2 Autopilot actions are awaiting execution; quiet is not delaying them.',
    );
  });
});
