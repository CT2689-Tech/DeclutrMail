import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { createTestQueryClient } from '@/test/query-wrapper';
import { HomeFixDialog } from './home-fix-dialog';
import type { HomeFixCandidate } from './home-next-steps';

const step: HomeFixCandidate = {
  kind: 'unsub_archive',
  senderCount: 2,
  emailCount: 999,
  senderIds: ['a', 'b'],
};
const counts = (all: number) => ({
  all,
  olderThan30d: 0,
  olderThan90d: 0,
  olderThan180d: 0,
  olderThan365d: 0,
});
const row = (senderId: string, all: number, protectedSender = false) => ({
  senderId,
  name: senderId,
  counts: counts(all),
  protected: protectedSender,
});
function mount(candidate = step) {
  const confirm = vi.fn();
  const client = createTestQueryClient();
  const tree = () => (
    <QueryClientProvider client={client}>
      <HomeFixDialog step={candidate} mailboxId="mb-live" onCancel={vi.fn()} onConfirm={confirm} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { confirm, client, view, tree };
}

describe('Home current cleanup preview', () => {
  it('blocks cached counts until the scoped fresh preview arrives, and confirms its included senders', async () => {
    let release!: (response: Response) => void;
    let scope: string | null = null;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: (req) => {
          scope = req.headers.get('X-Active-Mailbox-Id');
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        },
      },
    ]);
    const { confirm } = mount();
    const button = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(button).toBeDisabled();
    expect(screen.queryByText(/999 emails will/)).toBeNull();
    fireEvent.click(button);
    expect(confirm).not.toHaveBeenCalled();
    release(
      jsonOk({
        data: { senders: [row('a', 7), row('b', 20, true)], totals: counts(7), protectedCount: 1 },
      }),
    );
    await waitFor(() => expect(button).toBeEnabled());
    expect(scope).toBe('mb-live');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('7 emails');
    expect(screen.getByRole('heading')).toHaveTextContent('1 sender');
    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith({
      ...step,
      senderCount: 1,
      emailCount: 7,
      senderIds: ['a'],
    });
  });

  it('keeps a failed preview blocked and offers a working retry', async () => {
    let reads = 0;
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () =>
          ++reads === 1
            ? jsonServerError()
            : jsonOk({ data: { senders: [row('a', 4)], totals: counts(4), protectedCount: 0 } }),
      },
    ]);
    const { confirm } = mount();
    await screen.findByText(/Couldn’t refresh/);
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeEnabled(),
    );
    expect(reads).toBe(2);
  });

  it.each([
    [row('a', 0), row('b', 0)],
    [row('a', 5, true), row('b', 5, true)],
  ])('does not arm an empty or Protected-only selection', async (...senders) => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () => jsonOk({ data: { senders, totals: counts(0), protectedCount: 0 } }),
      },
    ]);
    const { confirm } = mount();
    await screen.findByText(/This cleanup is no longer available/);
    expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Review senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each([
    { protected: true, unsubAvailable: true },
    { protected: false, unsubAvailable: false },
  ])(
    'blocks an unavailable single sender without claiming the inbox is empty: %o',
    async (flags) => {
      installFetchStub([
        {
          method: 'GET',
          path: '/api/actions/preview',
          respond: () =>
            jsonOk({
              data: {
                sender: { id: 'a', name: 'A' },
                counts: counts(12),
                recentMessages: {},
                allMail: null,
                ...flags,
              },
            }),
        },
      ]);
      const { confirm } = mount({ ...step, senderCount: 1, senderIds: ['a'] });
      await screen.findByText(/This cleanup is no longer available/);
      expect(screen.getByRole('button', { name: 'Unsubscribe + Archive' })).toBeDisabled();
      expect(screen.queryByText(/No inbox email/)).toBeNull();
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it('uses a fresh single-sender count and rechecks when reopened', async () => {
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () =>
          jsonOk({
            data: {
              sender: { id: 'a', name: 'A' },
              counts: counts(++reads === 1 ? 3 : 1),
              recentMessages: {},
              allMail: null,
              unsubAvailable: true,
              protected: false,
            },
          }),
      },
    ]);
    const { view, tree } = mount({ ...step, senderCount: 1, senderIds: ['a'] });
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('3 emails'));
    view.rerender(<></>);
    view.rerender(tree());
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('1 email'));
    expect(reads).toBe(2);
  });
});
