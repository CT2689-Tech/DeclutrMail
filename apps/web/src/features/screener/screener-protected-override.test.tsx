/**
 * The Screener's Protected-sender override (D42/D245).
 *
 * A queued sender CAN be protected — the automatic sweep runs over every
 * sender in the mailbox with no Screener exclusion, and Sender Detail can
 * protect one by hand while it waits. Before this wiring the Screener
 * hardcoded `override: false`, so every A/L/D decision on such a sender
 * came back 409 PROTECTED_SENDER and the row could never leave the queue
 * — the user was told to go unprotect a sender they were about to act on
 * anyway.
 *
 * D245 excludes Protected from BULK and AUTOMATIC mail-changing actions.
 * A Screener decision is one sender, one deliberate click — neither. So
 * the preview names the protection, the confirm says "anyway", and the
 * POST carries the acknowledgement.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { SCREENER_QUEUE } from './data';
import { DecidePreview } from './decide-preview';
import { ScreenerScreen } from './screener-screen';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));
// Toast is the only user-visible failure surface here. Partial mock —
// everything else from the shared package stays real.
const h = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});

const protectedRow = SCREENER_QUEUE.find((r) => r.isProtected)!;
const plainRow = SCREENER_QUEUE.find((r) => !r.isProtected)!;

afterEach(() => {
  resetFetchStub();
});

describe('DecidePreview — Protected acknowledgement', () => {
  it('names the protection and its reason before the confirm', () => {
    render(
      <DecidePreview
        verb="delete"
        row={protectedRow}
        inboxCount={4}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/This sender is Protected/i);
    // The exact reason, not a generic "it's protected" (D245).
    expect(notice).toHaveTextContent(/you starred a message/i);
    expect(screen.getByRole('button', { name: /Confirm Delete anyway/i })).toBeEnabled();
  });

  it('says nothing about protection for Keep — it moves no mail', () => {
    render(
      <DecidePreview
        verb="keep"
        row={protectedRow}
        inboxCount={0}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /^Confirm Keep for/i })).toBeInTheDocument();
  });

  it('says nothing about protection for an unprotected sender', () => {
    // Two-sided: a notice only ever observed present is not a verified
    // notice.
    render(
      <DecidePreview
        verb="delete"
        row={plainRow}
        inboxCount={4}
        confirming={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /anyway/i })).toBeNull();
  });

  it('keeps a stable accessible name while the decision is in flight', () => {
    render(
      <DecidePreview
        verb="delete"
        row={protectedRow}
        inboxCount={4}
        confirming
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole('button', { name: /Confirm Delete anyway for/i });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('Confirming…');
  });
});

/** Preview stub for a row — Delete needs a live count before it confirms. */
function previewHandler(row: (typeof SCREENER_QUEUE)[number], all: number) {
  return {
    method: 'GET' as const,
    path: '/api/actions/preview',
    respond: () =>
      jsonOk({
        data: {
          sender: {
            id: row.senderId,
            name: row.senderName,
            domain: row.senderDomain,
            lastSeenDays: 0,
            repliedCount: 0,
            monthly: row.messageCount,
          },
          counts: {
            all,
            olderThan30d: 0,
            olderThan90d: 0,
            olderThan180d: 0,
            olderThan365d: 0,
          },
          recentSubjects: {
            all: [row.sampleSubject],
            olderThan30d: [],
            olderThan90d: [],
            olderThan180d: [],
            olderThan365d: [],
          },
          unsubAvailable: row.unsubscribeMethod !== 'none',
          protected: row.isProtected,
        },
      }),
  };
}

describe('ScreenerScreen — the acknowledgement reaches the wire', () => {
  async function confirmDeleteFor(row: (typeof SCREENER_QUEUE)[number]) {
    const bodies: Record<string, unknown>[] = [];
    installFetchStub([
      previewHandler(row, 4),
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: async (req: Request) => {
          bodies.push((await req.json()) as Record<string, unknown>);
          return jsonOk({
            data: {
              senderId: row.senderId,
              verb: 'delete',
              resolved: true,
              execution: {
                kind: 'enqueued',
                actionId: '99999999-9999-4999-8999-999999999999',
                status: 'queued',
                requestedCount: 4,
              },
            },
          });
        },
      },
      {
        method: 'GET',
        path: '/api/actions/99999999-9999-4999-8999-999999999999',
        respond: () =>
          jsonOk({
            data: {
              actionId: '99999999-9999-4999-8999-999999999999',
              status: 'done',
              requestedCount: 4,
              affectedCount: 4,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
      </QueryWrapper>,
    );

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${row.senderName} — expand`) }));
    fireEvent.keyDown(window, { key: 'd' });
    // Wait for the live count — confirming before it lands would make a
    // "no override" assertion pass because nothing was posted at all.
    await screen.findByText(/currently match in Inbox/i);
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(bodies).toHaveLength(1));
    return bodies[0]!;
  }

  it('posts override:true for a Protected sender', async () => {
    expect(await confirmDeleteFor(protectedRow)).toMatchObject({ override: true });
  });

  it('omits override entirely for an unprotected sender', async () => {
    const body = await confirmDeleteFor(plainRow);
    expect(Object.keys(body)).not.toContain('override');
  });
});

describe('ScreenerScreen — a conflict is named from its code, not its status', () => {
  // `CurrentMailboxGuard` runs in front of /api/screener/decide and
  // answers 409 too (NO_ACTIVE_MAILBOX / SELECT_MAILBOX /
  // MAILBOX_NOT_OWNED). Branching on the bare status made the handler
  // assert a cause it had never read — telling a user with no connected
  // mailbox that their SENDER was Protected, and refetching a queue that
  // was not the problem.
  it('does not call a NO_ACTIVE_MAILBOX conflict a protection problem', async () => {
    h.toast.mockClear();
    installFetchStub([
      previewHandler(protectedRow, 4),
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () =>
          new Response(
            JSON.stringify({
              error: { code: 'NO_ACTIVE_MAILBOX', message: 'No active Gmail account.' },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);

    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
      </QueryWrapper>,
    );

    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`${protectedRow.senderName} — expand`) }),
    );
    fireEvent.keyDown(window, { key: 'd' });
    await screen.findByText(/currently match in Inbox/i);
    fireEvent.keyDown(window, { key: 'Enter' });

    await waitFor(() => expect(h.toast).toHaveBeenCalled());
    const messages = h.toast.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => /Couldn.t delete/i.test(m))).toBe(true);
    expect(messages.some((m) => /Protected/i.test(m))).toBe(false);
  });
});
