/**
 * Behavioral test for the Screener K/A/U/L/D keyboard wiring (#220).
 *
 * The main screener-screen.test renders to STATIC markup (no DOM events),
 * so the window keydown handler — expanded-row targeting, Enter/Escape,
 * the input guard — was only covered at the pure-resolver level. This
 * exercises the real handler in jsdom. Uses `keep` (no composite-preview
 * fetch) so the assertion needs no network stub.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';

import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));

function renderReady() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
    </QueryWrapper>,
  );
}

const PREVIEW = 'Preview · before anything changes';
const firstRow = SCREENER_QUEUE[0]!;
const noChannelRow = SCREENER_QUEUE.find((row) => row.unsubscribeMethod === 'none')!;

afterEach(() => {
  resetFetchStub();
});

function livePreviewHandler(all: number, allMailTotal?: number) {
  return {
    method: 'GET' as const,
    path: '/api/actions/preview',
    respond: () =>
      jsonOk({
        data: {
          sender: {
            id: firstRow.senderId,
            name: firstRow.senderName,
            domain: firstRow.senderDomain,
            lastSeenDays: 0,
            repliedCount: 0,
            monthly: 1,
          },
          counts: {
            all,
            olderThan30d: 0,
            olderThan90d: 0,
            olderThan180d: 0,
            olderThan365d: 0,
          },
          recentMessages: {
            all: [],
            olderThan30d: [],
            olderThan90d: [],
            olderThan180d: [],
            olderThan365d: [],
          },
          // ADR-0028 — present only when the test wants the reach chips
          // (absent = an API predating the field; the chips must hide).
          ...(allMailTotal !== undefined
            ? {
                allMail: {
                  counts: {
                    all: allMailTotal,
                    olderThan30d: 0,
                    olderThan90d: 0,
                    olderThan180d: 0,
                    olderThan365d: 0,
                  },
                  recentMessages: {
                    all: [],
                    olderThan30d: [],
                    olderThan90d: [],
                    olderThan180d: [],
                    olderThan365d: [],
                  },
                },
              }
            : {}),
          unsubAvailable: true,
          protected: false,
        },
      }),
  };
}

function expandFirstRow() {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`${firstRow.senderName} — expand`) }),
  );
}

describe('Screener keyboard handler (#220, D226)', () => {
  it('K on the EXPANDED row opens the mandatory preview (never a direct mutation)', () => {
    renderReady();
    expandFirstRow();
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  });

  it('Escape cancels the open preview', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('does nothing when NO row is expanded (no ghost preview)', () => {
    renderReady();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('a modifier chord (Cmd/Ctrl) is ignored', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('disables click and U shortcut when the sender publishes no unsubscribe channel', () => {
    renderReady();
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`${noChannelRow.senderName} — expand`) }),
    );

    const unsubscribe = screen.getByRole('button', { name: /^Unsubscribe$/ });
    expect(unsubscribe).toBeDisabled();
    expect(unsubscribe).toHaveAttribute('title', expect.stringMatching(/No unsubscribe channel/i));
    fireEvent.keyDown(window, { key: 'u' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('Enter cannot confirm Archive when its live preview is unavailable', async () => {
    let decidePosted = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => jsonServerError('preview_down'),
      },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          decidePosted = true;
          return jsonServerError('must_not_run');
        },
      },
    ]);

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText(/Cancel and retry/i);

    fireEvent.keyDown(window, { key: 'Enter' });
    await Promise.resolve();
    expect(decidePosted).toBe(false);
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  });

  it('Enter confirms Archive after the current-match preview resolves', async () => {
    let decidePosted = false;
    const actionId = '99999999-9999-4999-8999-999999999999';
    installFetchStub([
      livePreviewHandler(2),
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          decidePosted = true;
          return jsonOk({
            data: {
              senderId: firstRow.senderId,
              verb: 'archive',
              resolved: true,
              execution: { kind: 'enqueued', actionId, status: 'queued', requestedCount: 2 },
            },
          });
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${actionId}`,
        respond: () =>
          jsonOk({
            data: {
              actionId,
              status: 'executing',
              requestedCount: 2,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText(/emails currently match in Inbox/i);

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(decidePosted).toBe(true));
  });
});

describe('Screener Delete reach (ADR-0028) — chips, Enter, and the wire', () => {
  const actionId = '99999999-9999-4999-8999-999999999999';

  function installDecideStub(opts: { allMailTotal?: number; bodies: Record<string, unknown>[] }) {
    installFetchStub([
      livePreviewHandler(2, opts.allMailTotal),
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: async (req: Request) => {
          opts.bodies.push((await req.json()) as Record<string, unknown>);
          return jsonOk({
            data: {
              senderId: firstRow.senderId,
              verb: 'delete',
              resolved: true,
              execution: { kind: 'enqueued', actionId, status: 'queued', requestedCount: 2 },
            },
          });
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${actionId}`,
        respond: () =>
          jsonOk({
            data: {
              actionId,
              status: 'executing',
              requestedCount: 2,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);
  }

  it('Enter with a reach chip focused confirms the decision — the chip never owns Enter', async () => {
    const bodies: Record<string, unknown>[] = [];
    installDecideStub({ allMailTotal: 9, bodies });

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'd' });
    const allMailChip = await screen.findByRole('radio', { name: /Inbox \+ archived/ });
    fireEvent.click(allMailChip);
    await screen.findByText(/currently match across inbox \+ archived/i);

    // Enter while the chip has focus: the screen handler claims the key
    // (defaultPrevented → fireEvent returns false), so in a real
    // browser the button's native Enter-activation cannot re-toggle the
    // chip — the decision confirms instead.
    allMailChip.focus();
    const notPrevented = fireEvent.keyDown(allMailChip, { key: 'Enter' });
    expect(notPrevented).toBe(false);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ verb: 'delete', reach: 'all_mail' });
  });

  it('the default reach travels as NO field at all (pre-reach wire shape)', async () => {
    const bodies: Record<string, unknown>[] = [];
    installDecideStub({ allMailTotal: 9, bodies });

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'd' });
    await screen.findByRole('radio', { name: /Inbox only/ });

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0]!)).not.toContain('reach');
  });

  it('hides the chips entirely against an API without the all-mail block (deploy skew)', async () => {
    const bodies: Record<string, unknown>[] = [];
    installDecideStub({ bodies });

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'd' });
    await screen.findByText(/emails currently match in Inbox/i);
    expect(screen.queryByRole('radiogroup', { name: 'Where it applies' })).toBeNull();

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0]!)).not.toContain('reach');
  });
});
