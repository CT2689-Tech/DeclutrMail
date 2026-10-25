import { ToastHost } from '@declutrmail/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { pendingActionFeedback } from '@/features/undo/feedback-store';

import { InboxReportFirstLanding } from './first-landing-entry';

const report: InboxReportDto = {
  generatedAt: '2026-10-11T00:00:00.000Z',
  mailboxSizeBucket: 'under_1gb',
  insights: [
    {
      id: 'mostly_unread_share',
      pct: 49,
      senderCount: 1,
      sweeperExcluded: 0,
      window: '90d',
    },
  ],
  fix: { senderKeys: ['s1'], sendersCount: 1, inboxEmailCount: 4 },
  fallbackSenderCount: 1,
  receivedCount: 40,
  totalBytes: 1000,
  variant: 'full',
};

afterEach(() => {
  resetFetchStub();
  vi.unstubAllEnvs();
  localStorage.removeItem('dm-inbox-report-celebration:mb-1');
  sessionStorage.removeItem('dm-inbox-report-celebration:mb-1');
});

describe('InboxReportFirstLanding', () => {
  it('ignores an old optimistic celebration after reload', async () => {
    localStorage.setItem(
      'dm-inbox-report-celebration:mb-1',
      JSON.stringify({ archived: 40, senders: 1, actionId: 'queued', actionHandle: 'batch' }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    expect(await screen.findByText('1 sender worth reviewing.')).toBeVisible();
    expect(screen.queryByText(/Archived/)).toBeNull();
    expect(document.querySelector('[data-celebration]')).toBeNull();
  });

  it('Home reopens a dismissed report, and Close still works on that deep link', async () => {
    localStorage.setItem('dm-inbox-report-dismissed:mb-1', '1');
    window.history.replaceState(null, '', '/senders#inbox-report');
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close Inbox Report' }));
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeVisible();
    expect(window.location.hash).toBe('');
    localStorage.removeItem('dm-inbox-report-dismissed:mb-1');
  });

  it('shows loading, then a recoverable error, then the report after retry', async () => {
    let fail: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      fail = resolve;
    });
    let calls = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => (++calls === 1 ? response : jsonOk({ data: report })),
      },
    ]);
    const client = createTestQueryClient();
    client.setDefaultOptions({ queries: { retry: false } });
    render(
      <QueryWrapper client={client}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading snapshot…');
    await act(async () => {
      fail?.(jsonServerError());
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Couldn’t load your Inbox Report');
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    expect(await screen.findByRole('button', { name: 'Close Inbox Report' })).toBeVisible();
  });

  it('passes the report IDs to review without submitting cleanup', async () => {
    const review = vi.fn();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} onReview={review} />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Review senders' }));
    expect(review).toHaveBeenCalledWith(['s1']);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each(['archive', 'delete'] as const)(
    'forwards the selected age from the %s add-on to the cleanup request',
    async (mode) => {
      let submitted: unknown = null;
      const counts = {
        all: 4,
        olderThan30d: 3,
        olderThan90d: 2,
        olderThan180d: 1,
        olderThan365d: 0,
      };
      const recentMessages = {
        all: [],
        olderThan30d: [],
        olderThan90d: [],
        olderThan180d: [],
        olderThan365d: [],
      };
      installFetchStub([
        {
          method: 'GET',
          path: '/api/mailboxes/mb-1/inbox-report',
          respond: () => jsonOk({ data: report }),
        },
        {
          method: 'GET',
          path: '/api/actions/preview',
          respond: () =>
            jsonOk({
              data: {
                sender: {
                  id: 's1',
                  name: 'Sample sender',
                  domain: 'sample.example',
                  lastSeenDays: 1,
                  wroteToCount: 0,
                },
                counts,
                recentMessages,
                allMail: { counts: { ...counts, all: 12, olderThan180d: 6 }, recentMessages },
                unsubAvailable: true,
                protected: false,
              },
            }),
        },
        {
          method: 'POST',
          path: '/api/actions/unsubscribe-backlog',
          respond: async (req) => {
            submitted = await req.json();
            return jsonServerError();
          },
        },
      ]);
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
        </QueryWrapper>,
      );
      fireEvent.click(await screen.findByText('Details'));
      fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
      const archive = await screen.findByRole('radio', { name: '+ Archive' });
      await waitFor(() => expect(archive).toBeEnabled());
      if (mode === 'delete') {
        fireEvent.click(screen.getByRole('radio', { name: '+ Delete' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
      }
      fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
        target: { value: '180' },
      });
      expect(
        screen.getByRole('region', {
          name: mode === 'delete' ? 'What Delete will do' : 'What Archive will do',
        }),
      ).toHaveTextContent(mode === 'delete' ? '6 emails' : '1 email');
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'delete' ? 'Unsubscribe + Delete' : 'Unsubscribe + Archive',
        }),
      );
      await waitFor(() =>
        expect(submitted).toMatchObject({
          mode,
          senderIds: ['s1'],
          olderThanDays: 180,
          ...(mode === 'delete' ? { reach: 'all_mail' } : {}),
        }),
      );
    },
  );

  it('forwards the widened Delete scope shown in the report preview', async () => {
    let submitted: unknown = null;
    const counts = { all: 4, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
    const recentMessages = {
      all: [],
      olderThan30d: [],
      olderThan90d: [],
      olderThan180d: [],
      olderThan365d: [],
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () =>
          jsonOk({
            data: {
              sender: {
                id: 's1',
                name: 'Sample sender',
                domain: 'sample.example',
                lastSeenDays: 1,
                wroteToCount: 0,
              },
              counts,
              recentMessages,
              allMail: { counts: { ...counts, all: 12 }, recentMessages },
              unsubAvailable: true,
              protected: false,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-backlog',
        respond: async (req) => {
          submitted = await req.json();
          return jsonServerError();
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    const option = await screen.findByRole('radio', { name: '+ Delete' });
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.click(option);
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '12 emails',
    );
    fireEvent.click(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    );
    await waitFor(() =>
      expect(submitted).toMatchObject({ mode: 'delete', reach: 'all_mail', senderIds: ['s1'] }),
    );
    expect(submitted).not.toHaveProperty('olderThanDays');
  });

  it('posts only the report senders the live preview included', async () => {
    let submitted: { senderIds?: string[] } | null = null;
    const two: InboxReportDto = {
      ...report,
      fix: { senderKeys: ['s1', 's2'], sendersCount: 2, inboxEmailCount: 9 },
    };
    const counts = { all: 4, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: two }),
      },
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () =>
          jsonOk({
            data: {
              senders: [
                { senderId: 's1', name: 'Kept', counts, protected: false },
                {
                  senderId: 's2',
                  name: 'Protected',
                  counts: { ...counts, all: 5 },
                  protected: true,
                },
              ],
              totals: counts,
              protectedCount: 1,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-backlog',
        respond: async (req) => {
          submitted = (await req.json()) as { senderIds?: string[] };
          return jsonServerError();
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    const archive = await screen.findByRole('radio', { name: '+ Archive' });
    await waitFor(() => expect(archive).toBeEnabled());
    fireEvent.click(archive);
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(submitted?.senderIds).toEqual(['s1']));
  });

  it('reports a recoverable snapshot failure', async () => {
    const onResolved = vi.fn();
    installFetchStub([]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={onResolved} />
      </QueryWrapper>,
    );
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(false));
    expect(screen.queryByText(/mostly leave unread/)).toBeNull();
  });

  it('shows the report and confirms unsubscribe plus archive', async () => {
    const bodies: unknown[] = [];
    const onResolved = vi.fn();
    let releasePreview: (response: Response) => void = () => {};
    const preview = new Promise<Response>((resolve) => {
      releasePreview = resolve;
    });
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => preview,
      },
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-backlog',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: {
              mode: 'archive',
              backlog: { actionId: 'act-1', requestedCount: 4, verb: 'archive' },
              senders: [
                {
                  senderId: 's1',
                  method: 'one_click',
                  mailtoUrl: null,
                  executionActionId: null,
                  lifecycleStatus: null,
                  unsubStatus: 'requested',
                  reasonCode: null,
                },
              ],
            },
          });
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ToastHost />
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={onResolved} />
      </QueryWrapper>,
    );
    expect(await screen.findByText('1 sender worth reviewing.')).toBeInTheDocument();
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('archive 4 emails');
    expect(screen.getByRole('dialog')).toHaveTextContent(WS5_COPY['f1.preview.backlog.loading']);
    expect(screen.getByRole('dialog')).not.toHaveTextContent('0 emails you already have');
    releasePreview(
      jsonOk({
        data: {
          sender: {
            id: 's1',
            name: 'Acme',
            domain: 'acme.example',
            lastSeenDays: 1,
            wroteToCount: 0,
          },
          counts: { all: 7, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
          recentMessages: {
            all: [],
            olderThan30d: [],
            olderThan90d: [],
            olderThan180d: [],
            olderThan365d: [],
          },
          unsubAvailable: true,
          protected: false,
        },
      }),
    );
    const archiveChoice = await screen.findByRole('radio', {
      name: '+ Archive',
    });
    await waitFor(() => expect(archiveChoice).toBeEnabled());
    expect(archiveChoice).toBeChecked();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Unsubscribe from ?');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('1 senders');
    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      WS5_COPY['f1.preview.backlog.loading'],
    );
    expect(
      screen.getByRole('heading', { name: 'Unsubscribe from this sender?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(
      pluralCopy(WS5_COPY['f1.preview.backlog.archive'], 7, { n: 7 }),
    );
    fireEvent.click(archiveChoice);
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent(
      '7 emails',
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      mode: 'archive',
      senderIds: ['s1'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/Archived/)).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
    await waitFor(() =>
      expect(pendingActionFeedback('mb-1')).toEqual([
        expect.objectContaining({ groupId: 'act-1', verb: 'archive', senderIds: ['s1'] }),
      ]),
    );
  });

  it('reports unsubscribe-only requests without persisting a success banner', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () =>
          jsonOk({
            data: {
              sender: {
                id: 's1',
                name: 'Acme',
                domain: 'acme.example',
                lastSeenDays: 1,
                wroteToCount: 0,
              },
              counts: {
                all: 7,
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
              unsubAvailable: true,
              protected: false,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-backlog',
        respond: () =>
          jsonOk({
            data: {
              mode: 'unsub_only',
              backlog: null,
              senders: [
                {
                  senderId: 's1',
                  method: 'one_click',
                  mailtoUrl: null,
                  executionActionId: null,
                  lifecycleStatus: null,
                  unsubStatus: 'requested',
                  reasonCode: null,
                },
              ],
            },
          }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ToastHost />
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    fireEvent.click(await screen.findByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Preview bulk cleanup' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Unsubscribe only' }));
    // Confirm stays closed while the single-sender preview is still loading.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Unsubscribe requested');
    expect(document.querySelector('[data-celebration]')).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
  });
});
