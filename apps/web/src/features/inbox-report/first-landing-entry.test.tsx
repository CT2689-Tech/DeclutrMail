import { ToastHost } from '@declutrmail/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    const option = await screen.findByRole('radio', { name: '+ Delete 4' });
    await waitFor(() => expect(option).toBeEnabled());
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('radio', { name: /Inbox \+ archived/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('delete 12 emails');
    fireEvent.click(screen.getByRole('button', { name: 'Unsubscribe + Delete' }));
    await waitFor(() =>
      expect(submitted).toMatchObject({ mode: 'delete', reach: 'all_mail', senderIds: ['s1'] }),
    );
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

  it('drops the stored archive result after Undo finishes and offers the fix again', async () => {
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
            },
          }),
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
      </QueryWrapper>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: WS5_COPY['report.celebrate.undo.button'] }),
    );
    expect(
      await screen.findByRole('button', { name: 'Unsubscribe + archive 1 sender' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Archived 4 emails from 1 sender.')).toBeNull();
    expect(localStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
    expect(sessionStorage.getItem('dm-inbox-report-celebration:mb-1')).toBeNull();
  });

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
    expect(screen.getByRole('radio', { name: '+ Archive' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: '+ Delete' })).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('archive 4 emails');
    expect(screen.getByRole('dialog')).toHaveTextContent(/Counting existing inbox email/);
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
      name: '+ Archive 7',
    });
    expect(archiveChoice).toBeEnabled();
    expect(archiveChoice).toBeChecked();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Unsubscribe from ?');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('1 senders');
    expect(screen.getByRole('dialog')).not.toHaveTextContent(
      WS5_COPY['f1.preview.backlog.loading'],
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Unsubscribe from Acme and archive 7 emails?',
    );
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Existing inbox email leaves your inbox and stays in Gmail.',
    );
    fireEvent.click(archiveChoice);
    const confirm = screen.getByRole('button', { name: 'Unsubscribe + Archive' });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('dialog')).toHaveTextContent('archive 7 emails');
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
