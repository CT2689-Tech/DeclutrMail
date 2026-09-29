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
import { onlineManager } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from '@declutrmail/shared';
import userEvent from '@testing-library/user-event';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import type { Me } from '@/features/auth/api/use-me';
import { captureFeatureException } from '@/lib/sentry';
import { QuietRoute } from './quiet-screen';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});

vi.mock('@/lib/sentry', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, captureFeatureException: vi.fn() };
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

/**
 * An API deployed before the web still sends the retired `endsAt`. The
 * status line must not repeat the End row from it.
 */
const OLD_API_ENDS_AT = '2026-07-15T05:00:00.000Z';

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

const quietPath = (id: string) => `/api/mailboxes/${id}/quiet-hours`;
const saveStatus = (email: string) =>
  screen.getByRole('status', { name: `Save status for ${email}` });

describe('QuietRoute', () => {
  beforeEach(() => {
    installFetchStub([]);
  });
  afterEach(() => {
    resetFetchStub();
    vi.mocked(toast).mockClear();
    vi.mocked(captureFeatureException).mockClear();
  });

  it('links only the active inbox to its Autopilot rules', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com'), mailbox(MAILBOX_B, 'b@b.com')]);
    installFetchStub(
      [MAILBOX_A, MAILBOX_B].map((id) => ({
        method: 'GET' as const,
        path: quietPath(id),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 2 }),
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
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 0 }),
      },
      {
        method: 'GET',
        path: quietPath(MAILBOX_B),
        respond: () => jsonEnvelope({ config: null, activeNow: false, heldCount: 0 }),
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
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0 }),
      },
      {
        method: 'PUT',
        path: quietPath(MAILBOX_A),
        respond: async (req) => {
          putBody = await req.json();
          return jsonEnvelope({ config: putBody, activeNow: true, heldCount: 0 });
        },
      },
    ]);

    renderRoute();
    const checkbox = await screen.findByRole('switch', { name: 'Quiet hours' });
    // In place and silent before the save: a region inserted together
    // with its text, or one that already says it, announces nothing.
    const region = saveStatus('a@b.com');
    expect(region.textContent).toBe('');
    await userEvent.click(checkbox); // enabled: true → false (dirty)
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => expect(putBody).not.toBeNull());
    expect(putBody).toEqual({ ...CONFIG, enabled: false });
    // Server said activeNow: true → the pill renders from the response.
    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
    // The SAME node says it, although the form remounted — not a toast.
    expect(saveStatus('a@b.com')).toBe(region);
    expect(region).toHaveTextContent('Saved');
    expect(toast).not.toHaveBeenCalled();
  });

  it('stops saying Saved once the form is edited again', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0 }),
      },
      {
        method: 'PUT',
        path: quietPath(MAILBOX_A),
        respond: async (req) =>
          jsonEnvelope({ config: await req.json(), activeNow: false, heldCount: 0 }),
      },
    ]);

    renderRoute();
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    await waitFor(() => expect(saveStatus('a@b.com')).toHaveTextContent('Saved'));

    await userEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));

    expect(saveStatus('a@b.com').textContent).toBe('');
  });

  it('warns and reports a failed save, and never says Saved', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0 }),
      },
      { method: 'PUT', path: quietPath(MAILBOX_A), respond: () => jsonServerError() },
    ]);

    renderRoute();
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Saving failed. Try again.', 'warn'));
    expect(captureFeatureException).toHaveBeenCalledWith(expect.anything(), {
      surface: 'quiet',
      reason: 'save_hours_failed',
    });
    expect(saveStatus('a@b.com').textContent).toBe('');
  });

  it('still warns and reports a save that fails after the page is gone', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    let failPut: (() => void) | undefined;
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0 }),
      },
      {
        method: 'PUT',
        path: quietPath(MAILBOX_A),
        respond: () =>
          new Promise<Response>((resolve) => {
            failPut = () => resolve(jsonServerError());
          }),
      },
    ]);

    const { unmount } = renderRoute();
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    await waitFor(() => expect(failPut).toBeDefined());

    // The user navigates away while the PUT is still in flight.
    unmount();
    failPut?.();

    await waitFor(() => expect(toast).toHaveBeenCalledWith('Saving failed. Try again.', 'warn'));
    expect(captureFeatureException).toHaveBeenCalledTimes(1);
  });

  it('says Saved once a never-configured mailbox saves', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: null, activeNow: false, heldCount: 0 }),
      },
      {
        method: 'PUT',
        path: quietPath(MAILBOX_A),
        respond: async (req) =>
          jsonEnvelope({ config: await req.json(), activeNow: false, heldCount: 0 }),
      },
    ]);

    renderRoute();
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));

    // The visible label, not its screen-reader twin in the save status.
    expect(
      await screen.findByText('Saved', { ignore: '[role="status"], script, style' }),
    ).toBeInTheDocument();
  });

  it('keeps loading, not an unconfigured form, while the read waits offline', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    onlineManager.setOnline(false);
    const { unmount } = renderRoute();
    try {
      expect(await screen.findByTestId('quiet-card-loading')).toBeInTheDocument();
      expect(screen.queryByRole('switch', { name: 'Quiet hours' })).not.toBeInTheDocument();
    } finally {
      // Unmount first, so the paused read never resumes against the stub.
      unmount();
      onlineManager.setOnline(true);
    }
  });

  it('drops the held summary when a refresh fails', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    let failing = false;
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () =>
          failing
            ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'boom' } }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              })
            : jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 2 }),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <QuietRoute />
      </QueryWrapper>,
    );
    expect(await screen.findByText(/2 Autopilot actions/)).toBeInTheDocument();

    failing = true;
    await act(async () => {
      await client.invalidateQueries();
    });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/Autopilot actions/)).not.toBeInTheDocument();
  });

  it('never says Saved beside a failed refresh, or after its retry', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    let failing = false;
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () =>
          failing
            ? jsonServerError()
            : jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 0 }),
      },
      {
        method: 'PUT',
        path: quietPath(MAILBOX_A),
        respond: async (req) =>
          jsonEnvelope({ config: await req.json(), activeNow: false, heldCount: 0 }),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <QuietRoute />
      </QueryWrapper>,
    );
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    await waitFor(() => expect(saveStatus('a@b.com')).toHaveTextContent('Saved'));

    failing = true;
    await act(async () => {
      await client.invalidateQueries();
    });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(saveStatus('a@b.com').textContent).toBe('');

    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('switch', { name: 'Quiet hours' })).toBeInTheDocument();
    expect(saveStatus('a@b.com').textContent).toBe('');
  });

  it('counts held actions while quiet is on, and not when it ends', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () =>
          jsonEnvelope({
            config: CONFIG,
            activeNow: true,
            heldCount: 2,
            endsAt: OLD_API_ENDS_AT,
          }),
      },
    ]);

    renderRoute();

    const summary = await screen.findByRole('status', { name: 'Quiet status for a@b.com' });
    expect(summary).toHaveTextContent(/\b2\b/);
    expect(summary).toHaveTextContent(/held/);
    // The End row already says when quiet ends; a rule's daily cap can
    // keep some actions past it, so no line promises a release time.
    expect(summary.querySelector('time')).toBeNull();
    expect(summary).not.toHaveTextContent(/ends|until/);
  });

  it('counts a single held action', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 1 }),
      },
    ]);

    renderRoute();

    const summary = await screen.findByRole('status', { name: 'Quiet status for a@b.com' });
    expect(summary).toHaveTextContent(/\b1\b/);
    expect(summary).toHaveTextContent(/held/);
  });

  it('shows no quiet status while nothing is held', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () =>
          jsonEnvelope({
            config: CONFIG,
            activeNow: true,
            heldCount: 0,
            endsAt: OLD_API_ENDS_AT,
          }),
      },
    ]);

    renderRoute();

    await waitFor(() => expect(screen.getByText('Quiet now')).toBeInTheDocument());
    expect(
      screen.queryByRole('status', { name: 'Quiet status for a@b.com' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Autopilot action|Quiet ends/)).not.toBeInTheDocument();
  });

  it('shows no quiet status while quiet is off', async () => {
    me = makeMe([mailbox(MAILBOX_A, 'a@b.com')]);
    installFetchStub([
      {
        method: 'GET',
        path: quietPath(MAILBOX_A),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: false, heldCount: 2 }),
      },
    ]);

    renderRoute();

    expect(await screen.findByLabelText('Quiet window start')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Quiet status for a@b.com' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Autopilot action/)).not.toBeInTheDocument();
  });

  it('shows no quiet status on a disconnected inbox', async () => {
    // Its row is disabled in the account menu, and nothing runs for it
    // until it is reconnected — an instruction there could not be followed.
    me = makeMe([
      mailbox(MAILBOX_A, 'a@b.com'),
      { ...mailbox(MAILBOX_B, 'b@b.com'), status: 'disconnected' },
    ]);
    installFetchStub(
      [MAILBOX_A, MAILBOX_B].map((id) => ({
        method: 'GET' as const,
        path: quietPath(id),
        respond: () => jsonEnvelope({ config: CONFIG, activeNow: true, heldCount: 2 }),
      })),
    );

    renderRoute();

    expect(
      await screen.findByRole('status', { name: 'Quiet status for a@b.com' }),
    ).toBeInTheDocument();
    const disconnected = screen.getByRole('region', { name: 'Quiet hours for b@b.com' });
    expect(within(disconnected).getByText('Disconnected')).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: 'Quiet status for b@b.com' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Choose this inbox in the account menu/)).not.toBeInTheDocument();
  });
});
