import { ToastHost } from '@declutrmail/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pluralCopy, WS5_COPY } from '@declutrmail/shared/copy/launch';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
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
});

describe('InboxReportFirstLanding', () => {
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
    expect(
      screen.getByRole('radio', { name: 'Unsubscribe and archive, counting emails' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('radio', { name: 'Unsubscribe and delete, counting emails' }),
    ).toBeDisabled();
    expect(screen.getByRole('dialog')).not.toHaveTextContent('archive 4 emails');
    releasePreview(
      jsonOk({
        data: {
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
      name: 'Unsubscribe and archive 7 emails',
    });
    expect(archiveChoice).toBeEnabled();
    expect(archiveChoice).not.toBeChecked();
    expect(screen.getByRole('dialog')).toHaveTextContent('Unsubscribe from ?');
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
});
