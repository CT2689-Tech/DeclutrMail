import { asc, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { brandDomainAliases } from '../src';
import { freshTestDb } from '../src/testing';

describe('brand_domain_aliases', () => {
  it('seeds authoritative mailing-domain aliases for the shared icon cache', async () => {
    const db = await freshTestDb();

    const rows = await db
      .select({
        aliasDomain: brandDomainAliases.aliasDomain,
        canonicalDomain: brandDomainAliases.canonicalDomain,
        confidence: brandDomainAliases.confidence,
      })
      .from(brandDomainAliases)
      .orderBy(asc(brandDomainAliases.aliasDomain));

    expect(rows).toEqual([
      { aliasDomain: 'aexp.com', canonicalDomain: 'americanexpress.com', confidence: 100 },
      {
        aliasDomain: 'aexpfeedback.com',
        canonicalDomain: 'americanexpress.com',
        confidence: 100,
      },
      { aliasDomain: 'facebookmail.com', canonicalDomain: 'facebook.com', confidence: 100 },
      { aliasDomain: 'redditforcommunity.com', canonicalDomain: 'reddit.com', confidence: 100 },
      { aliasDomain: 'redditmail.com', canonicalDomain: 'reddit.com', confidence: 100 },
      { aliasDomain: 'temuemail.com', canonicalDomain: 'temu.com', confidence: 100 },
      { aliasDomain: 'temufavor.com', canonicalDomain: 'temu.com', confidence: 100 },
      { aliasDomain: 'temumail.com', canonicalDomain: 'temu.com', confidence: 100 },
      { aliasDomain: 'temuofficial.com', canonicalDomain: 'temu.com', confidence: 100 },
    ]);
  });

  it('contains no user linkage or foreign keys', async () => {
    const db = await freshTestDb();
    const columns = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'brand_domain_aliases'`,
    );
    const names = columns.rows.map((row) => row.column_name);
    expect(names.filter((name) => /user|mailbox|workspace|account|owner/.test(name))).toEqual([]);

    const foreignKeys = await db.execute<{ constraint_name: string }>(
      sql`SELECT constraint_name FROM information_schema.table_constraints
          WHERE table_schema = 'public'
            AND table_name = 'brand_domain_aliases'
            AND constraint_type = 'FOREIGN KEY'`,
    );
    expect(foreignKeys.rows).toEqual([]);
  });
});
