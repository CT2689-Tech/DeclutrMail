import { expect, it } from 'vitest';
import { freshTestDb } from '@declutrmail/db/testing';
import { cronRuns } from '@declutrmail/db';
import { sql } from 'drizzle-orm';
import { workerHeartbeatIsFresh, writeWorkerHeartbeat } from './worker-heartbeat.js';

it('fails closed before first boot and after worker loss, with one bounded heartbeat row', async () => {
  const db = await freshTestDb();
  expect(await workerHeartbeatIsFresh(db as never)).toBe(false);
  await writeWorkerHeartbeat(db as never);
  await writeWorkerHeartbeat(db as never);
  expect(await workerHeartbeatIsFresh(db as never)).toBe(true);
  expect(await db.select().from(cronRuns)).toHaveLength(1);
  await db.update(cronRuns).set({ finishedAt: sql`now() - interval '4 minutes'` });
  expect(await workerHeartbeatIsFresh(db as never)).toBe(false);
  await db.update(cronRuns).set({ finishedAt: sql`now() + interval '1 minute'` });
  expect(await workerHeartbeatIsFresh(db as never)).toBe(false);
});
