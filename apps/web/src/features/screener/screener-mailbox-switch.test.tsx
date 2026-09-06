import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';
import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

const h = vi.hoisted(() => ({ mailbox: 'account-a', toast: vi.fn(), capture: vi.fn() }));
vi.mock('@/features/auth/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: h.mailbox,
      user: { email: 'owner@example.com', timezone: 'UTC' },
      mailboxes: ['account-a', 'account-b'].map((id) => ({
        id,
        email: `${id}@example.com`,
        readiness: 'ready',
      })),
    },
  }),
}));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  toast: h.toast,
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: h.capture }));

const row = SCREENER_QUEUE.find((r) => !r.isProtected)!;
const actionId = '99999999-9999-4999-8999-999999999999';
const counts = { all: 2, olderThan30d: 2, olderThan90d: 2, olderThan180d: 2, olderThan365d: 2 };

function harness() {
  const client = createTestQueryClient();
  const ui = () => (
    <QueryWrapper client={client}>
      <ScreenerScreen state={{ kind: 'ready', rows: [row] }} />
    </QueryWrapper>
  );
  const view = render(ui());
  return {
    switchAccount: () => {
      act(() => {
        window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT));
      });
      h.mailbox = 'account-b';
      view.rerender(ui());
    },
  };
}

async function openArchive() {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${row.senderName} — expand`) }));
  fireEvent.keyDown(window, { key: 'a' });
  await screen.findByText(/emails in Inbox now/);
}

beforeEach(() => {
  h.mailbox = 'account-a';
  h.toast.mockClear();
  h.capture.mockClear();
});
afterEach(resetFetchStub);

describe('Screener account changes during a decision', () => {
  it('pins a delayed enqueue and its status to the original account', async () => {
    let finishEnqueue!: (response: Response) => void;
    const pendingEnqueue = new Promise<Response>((resolve) => {
      finishEnqueue = resolve;
    });
    let postedMailbox: string | null | undefined;
    const statusMailboxes: Array<string | null> = [];
    installFetchStub([
      { method: 'GET', path: '/api/actions/preview', respond: () => jsonOk({ data: { counts } }) },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: (req) => {
          postedMailbox = req.headers.get('X-Active-Mailbox-Id');
          return pendingEnqueue;
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${actionId}`,
        respond: (req) => {
          const mailbox = req.headers.get('X-Active-Mailbox-Id');
          statusMailboxes.push(mailbox);
          return mailbox === 'account-a'
            ? jsonOk({
                data: {
                  actionId,
                  status: 'done',
                  requestedCount: 2,
                  affectedCount: 2,
                  undoToken: null,
                  errorCode: null,
                },
              })
            : new Response(null, { status: 404 });
        },
      },
    ]);
    const { switchAccount } = harness();
    await openArchive();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(postedMailbox).toBeDefined());
    switchAccount();
    await act(async () => {
      finishEnqueue(
        jsonOk({
          data: {
            senderId: row.senderId,
            verb: 'archive',
            resolved: false,
            execution: { kind: 'enqueued', actionId, status: 'queued', requestedCount: 2 },
          },
        }),
      );
    });
    await waitFor(() => expect(statusMailboxes.length).toBeGreaterThan(0));
    expect(postedMailbox).toBe('account-a');
    expect(statusMailboxes.every((mailbox) => mailbox === 'account-a')).toBe(true);
    expect(h.capture).not.toHaveBeenCalled();
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('closes an old-account preview before cached rows have been replaced', async () => {
    const post = vi.fn(() => jsonOk({ data: {} }));
    installFetchStub([
      { method: 'GET', path: '/api/actions/preview', respond: () => jsonOk({ data: { counts } }) },
      { method: 'POST', path: '/api/screener/decide', respond: post },
    ]);
    const { switchAccount } = harness();
    await openArchive();
    switchAccount();
    expect(screen.queryByRole('region', { name: /Preview/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(post).not.toHaveBeenCalled();
  });
});
