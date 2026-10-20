import { ToastHost } from '@declutrmail/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

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
      fireEvent.click(
        await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }),
      );
      const archive = await screen.findByRole('radio', { name: 'Unsubscribe and archive' });
      await waitFor(() => expect(archive).toBeEnabled());
      if (mode === 'delete') {
        fireEvent.click(screen.getByRole('radio', { name: 'Unsubscribe and delete' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
      }
      fireEvent.change(screen.getByRole('combobox', { name: 'How far back' }), {
        target: { value: '180' },
      });
      expect(
        screen.getByRole('region', {
          name: mode === 'delete' ? 'Delete impact' : 'Archive impact',
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
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }));
    const option = await screen.findByRole('radio', { name: 'Unsubscribe and delete' });
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.click(option);
    fireEvent.change(screen.getByRole('combobox', { name: 'How far back' }), {
      target: { value: 'all' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include archived email' }));
    expect(screen.getByRole('region', { name: 'Delete impact' })).toHaveTextContent('12 emails');
    fireEvent.click(
      screen.getByRole('button', { name: /^Unsubscribe \+ Delete(?: [\d,]+ emails?)?$/ }),
    );
    await waitFor(() =>
      expect(submitted).toMatchObject({ mode: 'delete', reach: 'all_mail', senderIds: ['s1'] }),
    );
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
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe + archive 2 senders' }));
    const archive = await screen.findByRole('radio', { name: 'Unsubscribe and archive' });
    await waitFor(() => expect(archive).toBeEnabled());
    fireEvent.click(archive);
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(submitted?.senderIds).toEqual(['s1']));
  });

  it('undoes the latest archive when Activity has a token', async () => {
    const undoPosts: string[] = [];
    localStorage.setItem(
      'dm-inbox-report-celebration:mb-1',
      JSON.stringify({
        archived: 4,
        senders: 1,
        verb: 'archive',
        actionId: 'act-1',
        actionHandle: 'action',
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () => jsonOk({ data: report }),
      },
      {
        method: 'GET',
        path: '/api/actions/act-1',
        respond: () =>
          jsonOk({
            data: {
              actionId: 'act-1',
              verb: 'archive',
              direction: 'forward',
              status: 'done',
              requestedCount: 4,
              affectedCount: 4,
              wakeAt: null,
              undoToken: 'undo-1',
              undoExpiresAt: '2026-11-11T00:00:00.000Z',
              undoExecutedAt: null,
              undoRevertedAt: null,
              errorCode: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/undo/undo-1',
        respond: async (req) => {
          undoPosts.push(new URL(req.url, 'http://localhost').pathname);
          return jsonOk({
            data: {
              token: 'undo-1',
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: 'rev-1',
            },
          });
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    const undo = await screen.findByRole('button', {
      name: WS5_COPY['report.celebrate.undo.button'],
    });
    expect(screen.getByText(WS5_COPY['report.celebrate.undo'])).toBeInTheDocument();
    fireEvent.click(undo);
    await waitFor(() => expect(undoPosts).toEqual(['/api/undo/undo-1']));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] }),
      ).toBeNull(),
    );
    expect(screen.getByText(WS5_COPY['report.celebrate.undo'])).toBeInTheDocument();
  });

  it.each(['done', 'failed', 'unavailable'] as const)(
    'settles the stored result only after the complete Undo set (%s)',
    async (outcome) => {
      let finished = false;
      let groupReads = 0;
      const stored = JSON.stringify({
        archived: 4,
        senders: 1,
        verb: 'archive',
        actionId: 'act-1',
        actionHandle: 'action',
        senderKeys: ['s1'],
        fixGeneratedAt: report.generatedAt,
      });
      localStorage.setItem('dm-inbox-report-celebration:mb-1', stored);
      sessionStorage.setItem('dm-inbox-report-celebration:mb-1', stored);
      installFetchStub([
        {
          method: 'GET',
          path: '/api/mailboxes/mb-1/inbox-report',
          respond: () => jsonOk({ data: report }),
        },
        {
          method: 'GET',
          path: '/api/actions/act-1',
          respond: () =>
            jsonOk({
              data: {
                actionId: 'act-1',
                verb: 'archive',
                direction: 'forward',
                status: 'done',
                requestedCount: 4,
                affectedCount: 4,
                wakeAt: null,
                undoToken: 'undo-1',
                undoExpiresAt: '2026-11-11T00:00:00.000Z',
                undoExecutedAt: null,
                undoRevertedAt: null,
                errorCode: null,
              },
            }),
        },
        {
          method: 'POST',
          path: '/api/undo/undo-1',
          respond: () =>
            jsonOk({
              data: {
                token: 'undo-1',
                actionKind: 'archive',
                reverted: false,
                expired: false,
                revertedAt: null,
                actionId: 'rev-1',
                actionIds: ['rev-1', 'rev-2'],
              },
            }),
        },
        {
          method: 'POST',
          path: '/api/actions/undo-status',
          respond: () => {
            groupReads += 1;
            if (finished && outcome === 'unavailable') return jsonServerError();
            return jsonOk({
              data: {
                actionId: 'rev-1',
                verb: 'archive',
                direction: 'reverse',
                status: finished ? outcome : 'executing',
                requestedCount: 4,
                affectedCount: finished && outcome === 'done' ? 4 : 2,
                undoToken: null,
                undoRevertedAt: finished && outcome === 'done' ? '2026-10-12T00:00:00.000Z' : null,
                errorCode: null,
              },
            });
          },
        },
        {
          method: 'GET',
          path: '/api/actions/rev-1',
          respond: () =>
            jsonOk({
              data: {
                actionId: 'rev-1',
                verb: 'archive',
                direction: 'reverse',
                status: 'done',
                requestedCount: 4,
                affectedCount: 4,
                wakeAt: null,
                undoToken: null,
                undoExpiresAt: null,
                undoExecutedAt: null,
                undoRevertedAt: '2026-10-12T00:00:00.000Z',
                errorCode: null,
              },
            }),
        },
      ]);
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
          <ToastHost />
        </QueryWrapper>,
      );
      fireEvent.click(
        await screen.findByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] }),
      );
      await waitFor(() => expect(groupReads).toBe(1));
      expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).not.toBeNull();
      finished = true;
      if (outcome !== 'done') {
        // Unknown/failure must preserve the recovery route instead of
        // permanently hiding this panel's Undo after the first attempt.
        expect(
          await screen.findByRole(
            'button',
            { name: WS5_COPY['report.celebrate.undo.button'] },
            { timeout: 2500 },
          ),
        ).toBeInTheDocument();
        expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).not.toBeNull();
        expect(
          await screen.findByText(outcome === 'failed' ? /Undo failed/ : /Couldn’t confirm undo/i),
        ).toBeInTheDocument();
        return;
      }
      expect(
        await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Archived 4 emails from 1 sender.')).toBeNull();
      expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
      expect(sessionStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
    },
  );

  it.each([true, false])(
    'ignores a late Undo response after switching mailboxes (reverted=%s)',
    async (reverted) => {
      const stored = (id: string) =>
        JSON.stringify({
          archived: 4,
          senders: 1,
          verb: 'archive',
          actionId: `act-${id}`,
          actionHandle: 'action',
          senderKeys: ['s1'],
          fixGeneratedAt: report.generatedAt,
        });
      for (const id of ['a', 'b']) {
        localStorage.setItem(`dm-inbox-report-celebration:mb-${id}`, stored(id));
        sessionStorage.setItem(`dm-inbox-report-celebration:mb-${id}`, stored(id));
      }
      let release!: (response: Response) => void;
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      let posts = 0;
      const reversePolls: string[] = [];
      installFetchStub([
        {
          method: 'GET',
          path: /\/api\/mailboxes\/mb-[ab]\/inbox-report/,
          respond: () => jsonOk({ data: report }),
        },
        {
          method: 'GET',
          path: /\/api\/actions\/act-[ab]/,
          respond: (_req, url) =>
            jsonOk({
              data: {
                actionId: url.pathname.split('/').pop(),
                status: 'done',
                undoToken: url.pathname.endsWith('a') ? 'undo-a' : 'undo-b',
                undoExpiresAt: '2099-01-01T00:00:00.000Z',
              },
            }),
        },
        {
          method: 'POST',
          path: '/api/undo/undo-a',
          respond: () => {
            posts += 1;
            return pending;
          },
        },
        {
          method: 'POST',
          path: '/api/actions/undo-status',
          respond: (req) => {
            reversePolls.push(req.headers.get('X-Active-Mailbox-Id') ?? 'missing');
            return jsonOk({ data: { status: 'done' } });
          },
        },
      ]);
      const client = createTestQueryClient();
      const content = (id: string) => (
        <QueryWrapper client={client}>
          <InboxReportFirstLanding mailboxId={`mb-${id}`} onResolved={vi.fn()} />
          <ToastHost />
        </QueryWrapper>
      );
      const view = render(content('a'));
      fireEvent.click(
        await screen.findByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] }),
      );
      await waitFor(() => expect(posts).toBe(1));
      view.rerender(content('b'));
      await screen.findByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] });
      await act(async () => {
        release(
          jsonOk({
            data: {
              token: 'undo-a',
              actionKind: 'delete',
              reverted,
              expired: false,
              revertedAt: reverted ? '2026-10-15T12:00:00.000Z' : null,
              actionId: reverted ? null : 'reverse-a',
              actionIds: reverted ? [] : ['reverse-a'],
            },
          }),
        );
      });
      await waitFor(() =>
        expect(
          client
            .getMutationCache()
            .getAll()
            .some((mutation) => mutation.state.status === 'success'),
        ).toBe(true),
      );
      expect(
        screen.getByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] }),
      ).toBeInTheDocument();
      expect(localStorage.getItem('dm-inbox-report-celebration:mb-b')).toBe(stored('b'));
      expect(reversePolls).toEqual([]);
      view.unmount();
      for (const id of ['a', 'b']) {
        localStorage.removeItem(`dm-inbox-report-celebration:mb-${id}`);
        sessionStorage.removeItem(`dm-inbox-report-celebration:mb-${id}`);
      }
    },
  );

  it('drops a stored result when a later report lists those senders again', async () => {
    localStorage.setItem(
      'dm-inbox-report-celebration:mb-1',
      JSON.stringify({
        archived: 4,
        senders: 1,
        verb: 'archive',
        senderKeys: ['s1'],
        fixGeneratedAt: '2020-01-01T00:00:00.000Z',
      }),
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
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Archived 4 emails from 1 sender.')).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
  });

  it('keeps a stored result when the later report no longer offers those senders', async () => {
    localStorage.setItem(
      'dm-inbox-report-celebration:mb-1',
      JSON.stringify({
        archived: 4,
        senders: 1,
        verb: 'archive',
        senderKeys: ['s1'],
        fixGeneratedAt: '2020-01-01T00:00:00.000Z',
      }),
    );
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb-1/inbox-report',
        respond: () =>
          jsonOk({
            data: {
              ...report,
              generatedAt: '2026-10-12T00:00:00.000Z',
              fix: { senderKeys: [], sendersCount: 0, inboxEmailCount: 0 },
            },
          }),
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <InboxReportFirstLanding mailboxId="mb-1" onResolved={vi.fn()} />
      </QueryWrapper>,
    );
    expect(await screen.findByText('Archived 4 emails from 1 sender.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toContain('"senderKeys"');
  });

  it('keeps the done state after a reload and does not offer the action again', async () => {
    localStorage.setItem(
      'dm-inbox-report-celebration:mb-1',
      JSON.stringify({ archived: 4, senders: 1 }),
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
    expect(await screen.findByText('Archived 4 emails from 1 sender.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unsubscribe/ })).toBeNull();
    localStorage.removeItem('dm-inbox-report-celebration:mb-1');
  });

  it('stays hidden when the report request fails', async () => {
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
    expect(await screen.findByText(/mostly leave unread/)).toBeInTheDocument();
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + archive 1 sender' }));
    expect(screen.getByRole('radio', { name: 'Unsubscribe and archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Unsubscribe and delete' })).toBeDisabled();
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
      name: 'Unsubscribe and archive',
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
    expect(screen.getByRole('region', { name: 'Archive impact' })).toHaveTextContent('7 emails');
    fireEvent.click(confirm);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      mode: 'archive',
      senderIds: ['s1'],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      pluralCopy(WS5_COPY['f1.toast.both.archive'], 4, { n: 4 }),
    );
  });

  it('keeps an unsubscribe-only run done after it succeeds', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Unsubscribe only' }));
    // Confirm stays closed while the single-sender preview is still loading.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe' }));
    await waitFor(() =>
      expect(document.querySelector('[data-celebration]')).toHaveTextContent(
        'Unsubscribe requested from 1 sender',
      ),
    );
    expect(screen.queryByRole('button', { name: /Unsubscribe \+ archive/ })).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toContain(
      '"verb":"unsub_only"',
    );
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toContain(
      '"senderKeys":["s1"]',
    );
    localStorage.removeItem('dm-inbox-report-celebration:mb-1');
  });
});
