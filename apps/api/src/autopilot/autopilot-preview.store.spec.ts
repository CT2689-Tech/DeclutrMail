import { afterEach, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  MemoryAutopilotPreviewStore,
  RedisAutopilotPreviewStore,
  AUTOPILOT_PREVIEW_TTL_MS,
} from './autopilot-preview.store.js';

afterEach(() => vi.useRealTimers());

it('expires a preview after five minutes and refuses another mailbox or rule', async () => {
  vi.useFakeTimers();
  const store = new MemoryAutopilotPreviewStore();
  const first = await store.create('mailbox-a', 'rule-a', [
    { senderKey: 'a'.repeat(64), reason: 'Synthetic match', inboxCount: 0 },
  ]);
  expect(await store.read('mailbox-b', 'rule-a', first.previewId, 1)).toBeNull();
  expect(await store.read('mailbox-a', 'rule-b', first.previewId, 1)).toBeNull();
  await expect(store.read('mailbox-a', 'rule-a', first.previewId, 2)).rejects.toThrow(
    'Page is outside this preview',
  );
  await vi.advanceTimersByTimeAsync(AUTOPILOT_PREVIEW_TTL_MS);
  expect(await store.read('mailbox-a', 'rule-a', first.previewId, 1)).toBeNull();
});

it('shares a paged preview across API instances through Redis', async () => {
  const hashes = new Map<string, Record<string, string>>();
  const redis = {
    multi() {
      let key = '';
      let fields: Record<string, string> = {};
      const pipeline = {
        hset(k: string, values: Record<string, string>) {
          key = k;
          fields = values;
          return pipeline;
        },
        pexpireat() {
          return pipeline;
        },
        async exec() {
          hashes.set(key, fields);
          return [
            [null, 1],
            [null, 1],
          ];
        },
      };
      return pipeline;
    },
    async hmget(key: string, ...fields: string[]) {
      return fields.map((field) => hashes.get(key)?.[field] ?? null);
    },
    disconnect() {},
  } as unknown as Redis;
  const writer = new RedisAutopilotPreviewStore(redis);
  const reader = new RedisAutopilotPreviewStore(redis);
  const targets = Array.from({ length: 53 }, (_, index) => ({
    senderKey: index.toString(16).padStart(64, '0'),
    reason: 'Synthetic match',
    inboxCount: index,
  }));
  const first = await writer.create('mailbox-a', 'rule-a', targets);
  const last = await reader.read('mailbox-a', 'rule-a', first.previewId, 3);
  expect(last).toMatchObject({ page: 3, total: 53, targets: targets.slice(50) });
  expect(await reader.read('mailbox-b', 'rule-a', first.previewId, 3)).toBeNull();
});
