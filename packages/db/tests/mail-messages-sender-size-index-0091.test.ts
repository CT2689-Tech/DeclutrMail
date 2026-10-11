import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { freshTestPglite } from '../src/testing/index.js';

/**
 * Migration 0091 — partial index for the per-sender size SUM.
 *
 * The sum runs on the default Senders page and across every sender
 * for a size sort. It has to be built with CREATE INDEX CONCURRENTLY
 * outside a transaction: a plain CREATE INDEX inside Atlas's
 * transaction would block sync and action writes on mail_messages
 * for the whole build. 0090 stays the transactional cache table.
 */

const INDEX = 'mail_messages_account_sender_inbound_size_idx';
const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

function migration(name: string): string {
  return readFileSync(join(MIGRATIONS, name), 'utf8');
}

describe('migration 0091 — inbound size index', () => {
  it('builds concurrently, outside the 0090 transaction', () => {
    const forward = migration('0091_mail_messages_sender_size_idx.sql');
    const rollback = migration('0091_mail_messages_sender_size_idx.rollback');
    const cache = migration('0090_inbox_report_cache.sql');
    const cacheRollback = migration('0090_inbox_report_cache.rollback');

    expect(forward.startsWith('-- atlas:txmode none')).toBe(true);
    expect(forward).toMatch(
      /CREATE INDEX CONCURRENTLY IF NOT EXISTS "mail_messages_account_sender_inbound_size_idx"/,
    );
    expect(rollback.startsWith('-- atlas:txmode none')).toBe(true);
    expect(rollback).toMatch(
      /DROP INDEX CONCURRENTLY IF EXISTS "mail_messages_account_sender_inbound_size_idx"/,
    );
    expect(cache).not.toContain(INDEX);
    expect(cacheRollback).not.toContain(INDEX);
  });

  it('exists after a full migration replay, on mailbox, sender, and size', async () => {
    const pg = await freshTestPglite();
    const res = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'mail_messages' AND indexname = $1`,
      [INDEX],
    );

    expect(res.rows).toHaveLength(1);
    const def = (res.rows[0]?.indexdef ?? '').replace(/\s+/g, ' ');
    expect(def).toMatch(/mailbox_account_id/);
    expect(def).toMatch(/sender_key/);
    expect(def).toMatch(/size_bytes/);
    expect(def).toMatch(/WHERE/i);
    expect(def).toMatch(/is_outbound = false/i);
  });
});
