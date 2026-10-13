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
