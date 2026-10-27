import { createServer, type Server } from 'node:http';

import { freshTestDb } from '@declutrmail/db/testing';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { lockSubscription } from '../subscription-lock.js';
import {
  billingProviderSignal,
  runWithVerdictSignal,
  runWithBillingReadSignal,
  VERDICT_DB_STATEMENT_TIMEOUT_MS,
} from '../provider-signal.js';

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server has no port');
  return address.port;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function timeoutText(result: unknown): string {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && 'rows' in result
      ? (result as { rows: unknown[] }).rows
      : [];
  const row = rows[0] as { timeout?: unknown } | undefined;
  return String(row?.timeout ?? '');
}

describe('billing verdict abort scope', () => {
  it('aborts a stalled response body when the job deadline fires', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"ok":');
    });
    const port = await listen(server);
    const deadline = new AbortController();
    const started = Date.now();
    try {
      const pending = runWithVerdictSignal(deadline.signal, async () => {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: billingProviderSignal(60_000),
        });
        return res.json() as Promise<unknown>;
      });
      setTimeout(() => deadline.abort(new Error('deadline')), 30);
      await expect(pending).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await close(server);
    }
  });

  it('aborts a history response body without entering the verdict lock scope', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"ok":');
    });
    const port = await listen(server);
    const deadline = new AbortController();
    try {
      const pending = runWithBillingReadSignal(deadline.signal, async () => {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: billingProviderSignal(60_000),
        });
        return res.json() as Promise<unknown>;
      });
      setTimeout(() => deadline.abort(new Error('history deadline')), 30);
      await expect(pending).rejects.toThrow();
    } finally {
      await close(server);
    }
  });

  it('still times out a stalled body when no verdict pass is active', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"ok":');
    });
    const port = await listen(server);
    const started = Date.now();
    try {
      const pending = (async () => {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: billingProviderSignal(200),
        });
        return res.json() as Promise<unknown>;
      })();
      await expect(pending).rejects.toThrow();
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(5_000);
    } finally {
      await close(server);
    }
  });

  it('bounds the subscription lock only inside a verdict pass', async () => {
    const db = await freshTestDb();
    const outside = await db.transaction(async (tx) => {
      await lockSubscription(tx, 'paddle', 'sub_outside');
      return timeoutText(
        await tx.execute(sql`select current_setting('statement_timeout') as timeout`),
      );
    });
    const deadline = new AbortController();
    const inside = await runWithVerdictSignal(deadline.signal, () =>
      db.transaction(async (tx) => {
        await lockSubscription(tx, 'paddle', 'sub_inside');
        return timeoutText(
          await tx.execute(sql`select current_setting('statement_timeout') as timeout`),
        );
      }),
    );
    expect(outside).toBe('0');
    expect(
      inside === '15s' ||
        inside === '15000ms' ||
        inside === String(VERDICT_DB_STATEMENT_TIMEOUT_MS),
    ).toBe(true);
  });
});
