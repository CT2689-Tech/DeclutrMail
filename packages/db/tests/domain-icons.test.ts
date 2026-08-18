import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { DOMAIN_ICON_RESOLVER_VERSION, domainIcons } from '../src';
import { freshTestDb } from '../src/testing';

/**
 * Brand icon cache schema tests (ADR-0034).
 *
 * Two invariants worth a test rather than a comment:
 *
 *   1. NO USER LINKAGE. The table must never gain a column referencing
 *      a user or a mailbox. That is not a style preference — a
 *      per-user icon row turns a brand-asset cache into a queryable
 *      index of who receives mail from whom, which is the artifact
 *      D7/D228 says DeclutrMail does not hold. A future "just for
 *      debugging" column fails here.
 *   2. PAYLOAD/STATUS COHERENCE. `status='ok'` with a NULL image would
 *      serve a 200 with an empty body — a broken <img> on every
 *      surface rendering that sender, with the monogram floor bypassed
 *      exactly where it is needed. The CHECK makes that unstorable.
 */

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"/>');

/**
 * Drizzle wraps a driver error in a generic "Failed query" message and
 * hangs the Postgres error off `cause`, so the constraint name — the
 * only part worth asserting — is one level down.
 */
async function violation(insert: Promise<unknown>): Promise<string> {
  try {
    await insert;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return `${String(err)} ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  throw new Error('expected the insert to be rejected');
}

describe('domain_icons', () => {
  it('references no user or mailbox column', async () => {
    const db = await freshTestDb();

    const columns = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'domain_icons'
          ORDER BY column_name`,
    );
    const names = columns.rows.map((r) => r.column_name);

    expect(names).not.toContain('user_id');
    expect(names).not.toContain('mailbox_account_id');
    expect(names).not.toContain('workspace_id');
    // Belt and braces: nothing user-shaped under any other spelling.
    expect(names.filter((n) => /user|mailbox|workspace|account|owner/.test(n))).toEqual([]);
  });

  it('has no foreign keys at all', async () => {
    const db = await freshTestDb();

    // A cache keyed on a public identifier has nothing to reference.
    // Any FK appearing here means the table acquired a relationship to
    // user-scoped data.
    const fks = await db.execute<{ constraint_name: string }>(
      sql`SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'domain_icons'
            AND constraint_type = 'FOREIGN KEY'`,
    );

    expect(fks.rows).toEqual([]);
  });

  it('stores a resolved mark', async () => {
    const db = await freshTestDb();

    await db.insert(domainIcons).values({
      domain: 'chase.com',
      status: 'ok',
      image: SVG,
      mime: 'image/svg+xml',
      source: 'bimi',
      contentHash: 'a'.repeat(64),
      byteSize: SVG.byteLength,
    });

    const [row] = await db.select().from(domainIcons);
    expect(row?.domain).toBe('chase.com');
    expect(Buffer.from(row!.image!).equals(SVG)).toBe(true);
    expect(row?.fetchedAt).toBeInstanceOf(Date);
  });

  it('records Brandfetch provenance separately for its shorter cache term', async () => {
    const db = await freshTestDb();

    await db.insert(domainIcons).values({
      domain: 'retailmenot.com',
      status: 'ok',
      image: SVG,
      mime: 'image/png',
      source: 'brandfetch',
      contentHash: 'b'.repeat(64),
      byteSize: SVG.byteLength,
    });

    const [row] = await db.select().from(domainIcons);
    expect(row?.source).toBe('brandfetch');
  });

  it('stores a cached miss with no payload', async () => {
    const db = await freshTestDb();

    // The row that stops a logo-less sender re-enqueueing forever.
    await db.insert(domainIcons).values({ domain: 'tiny-newsletter.io', status: 'none' });

    const [row] = await db.select().from(domainIcons);
    expect(row?.status).toBe('none');
    expect(row?.image).toBeNull();
    expect(row?.source).toBeNull();
    expect(row?.resolverVersion).toBe(DOMAIN_ICON_RESOLVER_VERSION);
  });

  it('rejects ok without an image', async () => {
    const db = await freshTestDb();

    const message = await violation(
      db.insert(domainIcons).values({
        domain: 'chase.com',
        status: 'ok',
        mime: 'image/svg+xml',
        source: 'bimi',
        contentHash: 'a'.repeat(64),
        byteSize: 10,
      }),
    );

    expect(message).toMatch(/domain_icons_image_matches_status_chk/);
  });

  it('rejects a miss carrying a payload', async () => {
    const db = await freshTestDb();

    const message = await violation(
      db.insert(domainIcons).values({
        domain: 'tiny-newsletter.io',
        status: 'none',
        image: SVG,
        mime: 'image/svg+xml',
        source: 'bimi',
        contentHash: 'a'.repeat(64),
        byteSize: SVG.byteLength,
      }),
    );

    expect(message).toMatch(/domain_icons_image_matches_status_chk/);
  });
});
