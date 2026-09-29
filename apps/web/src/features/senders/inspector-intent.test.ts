import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import {
  fetchSenderDetail,
  fetchSenderMessages,
  fetchSenderTimeseries,
  fetchSenderHistory,
} from '@/lib/api/senders';
import { prefetchSenderInspector } from './inspector-intent';
import { senderTimeseriesQueryOptions } from './api/query-options';
import { sendersKeys } from './api/query-keys';

vi.mock('./detail/sender-detail-pane', () => ({ SenderDetailPane: () => null }));
vi.mock('@/lib/api/senders', () => ({
  fetchSenderDetail: vi.fn(),
  fetchSenderMessages: vi.fn(),
  fetchSenderTimeseries: vi.fn(),
  fetchSenderHistory: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('inspector intent warming', () => {
  it('deduplicates data warming through the real query cache and threads its cancellation signal', async () => {
    const reader = vi.mocked(fetchSenderDetail).mockResolvedValue({ data: { id: 'a' } } as never);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    prefetchSenderInspector(client, 'a');
    prefetchSenderInspector(client, 'a');
    await waitFor(() => expect(client.getQueryData(sendersKeys.detail('a'))).toBeDefined());
    expect(reader).toHaveBeenCalledTimes(1);
    expect(reader.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    prefetchSenderInspector(client, 'a');
    expect(reader).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it('lets mailbox resets abort a speculative read before it can seed old data', async () => {
    let requestSignal: AbortSignal | undefined;
    vi.mocked(fetchSenderDetail).mockImplementation((_id, signal) => {
      requestSignal = signal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () =>
          reject(new DOMException('Cancelled', 'AbortError')),
        );
      });
    });
    const client = new QueryClient();
    prefetchSenderInspector(client, 'cancel-me');
    await client.cancelQueries({ queryKey: sendersKeys.detail('cancel-me') });
    expect(requestSignal?.aborted).toBe(true);
    expect(client.getQueryData(sendersKeys.detail('cancel-me'))).toBeUndefined();
    client.clear();
  });
  it.each([{ saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }])(
    'does not speculate with restricted connection %j',
    (connection) => {
      vi.stubGlobal('navigator', { connection });
      const client = new QueryClient();
      const prefetch = vi.spyOn(client, 'prefetchQuery');
      prefetchSenderInspector(client, 'a');
      expect(prefetch).not.toHaveBeenCalled();
    },
  );
  it('does not block explicitly requested inspector data on Save-Data connections', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    const client = new QueryClient();
    const prefetch = vi.spyOn(client, 'prefetchQuery').mockResolvedValue(undefined);
    prefetchSenderInspector(client, 'explicit', false);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });
  it('starts every required read on selection before the lazy inspector mounts, and deduplicates revisits', async () => {
    const page = { data: [], meta: { pagination: { nextCursor: null } } };
    vi.mocked(fetchSenderDetail).mockResolvedValue({ data: { id: 'clicked' } } as never);
    vi.mocked(fetchSenderMessages).mockResolvedValue(page as never);
    vi.mocked(fetchSenderHistory).mockResolvedValue(page as never);
    vi.mocked(fetchSenderTimeseries).mockResolvedValue({ data: [] } as never);
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    prefetchSenderInspector(client, 'clicked', false);
    // These calls must start synchronously, without waiting for the component import.
    expect(fetchSenderMessages).toHaveBeenCalledTimes(1);
    expect(fetchSenderHistory).toHaveBeenCalledTimes(1);
    expect(fetchSenderTimeseries).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchSenderMessages).mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    for (const key of [
      sendersKeys.messages('clicked'),
      sendersKeys.history('clicked'),
      sendersKeys.timeseries('clicked'),
    ]) {
      expect(client.getQueryData(key)).toBeDefined();
    }
    prefetchSenderInspector(client, 'clicked', false);
    expect(fetchSenderMessages).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it('keeps hover speculation to the detail read only', () => {
    const client = new QueryClient();
    vi.mocked(fetchSenderDetail).mockResolvedValue({ data: {} } as never);
    prefetchSenderInspector(client, 'hovered');
    expect(fetchSenderMessages).not.toHaveBeenCalled();
    expect(fetchSenderHistory).not.toHaveBeenCalled();
    expect(fetchSenderTimeseries).not.toHaveBeenCalled();
    client.clear();
  });
  it('retains chart data on revisits but explicit invalidation still refreshes', async () => {
    const client = new QueryClient();
    const reader = vi.fn().mockResolvedValue({ data: [] });
    const options = senderTimeseriesQueryOptions('a', reader);
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    expect(reader).toHaveBeenCalledTimes(1);
    await client.invalidateQueries({ queryKey: sendersKeys.detail('a') });
    await client.fetchQuery(options);
    expect(reader).toHaveBeenCalledTimes(2);
    client.clear();
  });
});
