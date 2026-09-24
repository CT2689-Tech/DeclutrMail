import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.useRealTimers());

it('coalesces interval requests for staggered observers of the same scoped action', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000, gcTime: Infinity } },
  });
  const reads: number[] = [];
  const options = {
    queryKey: ['action-status', 'a', { mailboxId: 'mailbox-a' }],
    queryFn: async () => {
      reads.push(Date.now());
      return { status: 'executing' };
    },
    refetchInterval: 1000,
    refetchIntervalInBackground: true,
  };
  const first = new QueryObserver(client, options);
  const offFirst = first.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(400);
  const second = new QueryObserver(client, options);
  const offSecond = second.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(3600);
  expect(reads).toHaveLength(5); // initial + one read per second; not two observer streams
  offFirst();
  offSecond();
  client.clear();
});

it('overlapping pending interval reads share one promise, while different mailboxes stay distinct', async () => {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const read = vi.fn(
    () =>
      new Promise<{ status: string }>((resolve) =>
        setTimeout(() => resolve({ status: 'executing' }), 1500),
      ),
  );
  const options = { queryFn: read, refetchInterval: 1000, refetchIntervalInBackground: true };
  const observers = ['mailbox-a', 'mailbox-a', 'mailbox-b'].map(
    (mailboxId) =>
      new QueryObserver(client, { ...options, queryKey: ['action-status', 'a', { mailboxId }] }),
  );
  const unsubscribe = observers.map((observer) => observer.subscribe(() => {}));
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1500);
  expect(read).toHaveBeenCalledTimes(4);
  unsubscribe.forEach((off) => off());
  client.clear();
});
