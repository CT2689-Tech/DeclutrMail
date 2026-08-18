import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/** How a cross-domain brand relationship was established. */
export const brandDomainAliasSource = pgEnum('brand_domain_alias_source', [
  'official_documentation',
  'manual_review',
  'observed_redirect',
]);

/**
 * Verified mailing-domain aliases for the global brand-artwork cache.
 *
 * This table is deliberately global and carries no user/mailbox link.
 * It states public facts such as `temuemail.com -> temu.com`; it must
 * never become a record of which user received mail from either domain.
 */
export const brandDomainAliases = pgTable(
  'brand_domain_aliases',
  {
    aliasDomain: varchar('alias_domain', { length: 253 }).primaryKey(),
    canonicalDomain: varchar('canonical_domain', { length: 253 }).notNull(),
    source: brandDomainAliasSource('source').notNull(),
    /** 100 is required for automatic cache-key rewriting. */
    confidence: integer('confidence').notNull(),
    /** Public evidence supporting the relationship; never mailbox data. */
    evidenceUrl: varchar('evidence_url', { length: 2048 }),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    confidenceRange: check(
      'brand_domain_aliases_confidence_range_chk',
      sql`${table.confidence} BETWEEN 0 AND 100`,
    ),
    notSelfReferential: check(
      'brand_domain_aliases_not_self_referential_chk',
      sql`${table.aliasDomain} <> ${table.canonicalDomain}`,
    ),
  }),
);

export type BrandDomainAlias = typeof brandDomainAliases.$inferSelect;
export type NewBrandDomainAlias = typeof brandDomainAliases.$inferInsert;
