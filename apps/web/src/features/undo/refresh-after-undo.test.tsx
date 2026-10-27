import { useQuery } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { refreshAfterUndo } from './refresh-after-undo';

function ReportWatch() {
  useQuery({
    queryKey: ['activity', 'inbox-report', 'mb'],
    queryFn: async () => {
      const response = await fetch('/api/mailboxes/mb/inbox-report');
      const body = (await response.json()) as { data: { fix: { sendersCount: number } } };
      return body.data;
    },
    staleTime: 30_000,
  });
  return null;
}

afterEach(() => resetFetchStub());

describe('refreshAfterUndo', () => {
  it('refreshes active sender-rule counts without replacing an open approval snapshot', async () => {
    let matchingCount = 0;
    let reads = 0;
    const client = createTestQueryClient();
    const previewKey = ['autopilot-sender-rule-preview', 'mb', 'rule'] as const;
    client.setQueryData(previewKey, { previewId: 'approved-snapshot', totalCount: 3 });
    function RuleWatch() {
      useQuery({
        queryKey: ['autopilot', 'delete-review', 'mb', 'preset'],
        queryFn: async () => {
          reads += 1;
          return { matchingCount };
        },
        staleTime: 30_000,
      });
      useQuery({
        queryKey: ['autopilot-sender-rules', 'mb'],
        queryFn: async () => ({ matchingCount }),
        staleTime: 30_000,
      });
      return null;
    }
    const view = render(
      <QueryWrapper client={client}>
        <RuleWatch />
      </QueryWrapper>,
    );
    await waitFor(() => expect(reads).toBe(1));
    matchingCount = 3;

    await refreshAfterUndo(client, 'mb');

    expect(reads).toBe(2);
    expect(client.getQueryData(['autopilot-sender-rules', 'mb'])).toEqual({ matchingCount: 3 });
    expect(client.getQueryData(['autopilot', 'delete-review', 'mb', 'preset'])).toEqual({
      matchingCount: 3,
    });
    expect(client.getQueryState(previewKey)?.isInvalidated).toBe(false);
    expect(client.getQueryData(previewKey)).toEqual({
      previewId: 'approved-snapshot',
      totalCount: 3,
    });
    view.unmount();
  });

  it('returns during the rebuild wait when the signal aborts', async () => {
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/mailboxes/mb/inbox-report',
        respond: () => {
          reads += 1;
          return jsonOk({ data: { fix: { sendersCount: 7 } } });
        },
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <ReportWatch />
      </QueryWrapper>,
    );
    await waitFor(() => expect(reads).toBe(1));

    const controller = new AbortController();
    const pending = refreshAfterUndo(client, 'mb', controller.signal);
    await waitFor(() => expect(reads).toBe(2));
    const started = performance.now();
    controller.abort();
    await pending;
    expect(performance.now() - started).toBeLessThan(200);
    const afterAbort = reads;
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(reads).toBe(afterAbort);
    view.unmount();
  });
});
