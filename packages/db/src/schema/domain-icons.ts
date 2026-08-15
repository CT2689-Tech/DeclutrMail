import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { bytea } from './_custom-types';

/**
 * Brand icon cache (ADR-0034).
 *
 * ONE row per brand-root domain, for the WHOLE product. Not per user,
 * not per mailbox — see the privacy note below, which is the reason
 * this table looks the way it does.
 *
 * Populated by `DomainIconWorker` (batchPolicy, idempotency key =
 * domain) and read by `GET /api/icons/:domain`. A logo is a property
 * of a domain, not of anyone's relationship to it, so 4,000 users who
 * all receive mail from Chase share ONE row and ONE outbound fetch,
 * ever.
 *
 * PRIVACY (D7, D228, ADR-0034 §1). This table intentionally carries no
 * `user_id` and no `mailbox_account_id`. Adding either would turn a
 * brand-asset cache into a queryable index of who receives mail from
 * whom — exactly the artifact the privacy posture says we do not hold.
 * `domain-icons.test.ts` asserts the absence; do not "temporarily" add
 * a user column for debugging.
 *
 * NEGATIVE CACHING (ADR-0034 §2). `status='none'` is a real, stored
 * answer, not an absent row. A domain with no discoverable logo must
 * be remembered as such or every render of that sender re-enqueues a
 * fetch forever. Absence of a row means "never looked", which is the
 * only state that enqueues work.
 */
export const domainIconStatus = pgEnum('domain_icon_status', ['ok', 'none']);

/** Where an `ok` image came from — provenance for attribution + coverage review. */
export const domainIconSource = pgEnum('domain_icon_source', ['bimi', 'vendor']);

/** Refresh horizons (ADR-0034 §2), applied by the worker at write time. */
export const DOMAIN_ICON_TTL_DAYS = {
  /** A stored mark goes stale in 90d so rebrands eventually land. */
  ok: 90,
  /** A miss is retried after 30d so newly-published BIMI records land. */
  none: 30,
} as const;

export const domainIcons = pgTable(
  'domain_icons',
  {
    /**
     * Brand-root domain, lowercased — `chase.com`, never
     * `mail1.chase.com`. Producers normalize through the same
     * `brandRoot()` the monogram tint uses so a brand's subdomains
     * collapse to one row (and one fetch).
     *
     * Bounded `varchar(253)`: the DNS maximum name length. A
     * pathological sender cannot inflate the PK index.
     */
    domain: varchar('domain', { length: 253 }).primaryKey(),

    /** `ok` = image present. `none` = looked, found nothing (cached miss). */
    status: domainIconStatus('status').notNull(),

    /**
     * The mark itself. NULL whenever `status='none'` — enforced by
     * `domain_icons_image_matches_status_chk` in the migration so the
     * two columns can never disagree.
     *
     * Phase 1 stores BIMI's SVG verbatim (post-sanitization): vector,
     * a few KB, scales to every avatar size with no raster pipeline.
     * `bytea` rather than `text` so a Phase 2 vendor PNG/WebP lands in
     * the same column without a type migration.
     */
    image: bytea('image'),

    /** Content type to serve back. NULL iff `image` is NULL. */
    mime: varchar('mime', { length: 64 }),

    /** NULL when `status='none'` — nothing was sourced. */
    source: domainIconSource('source'),

    /**
     * Strong-ETag input. sha256 of `image`, hex. Lets the endpoint
     * answer conditional requests and lets a refresh skip the write
     * when a brand re-published byte-identical art.
     */
    contentHash: varchar('content_hash', { length: 64 }),

    /**
     * Bytes stored, denormalized for cheap cache-size reporting
     * without summing `length(image)` over the table.
     */
    byteSize: integer('byte_size'),

    /** Last resolution attempt. Drives the TTL sweep — see `DOMAIN_ICON_TTL_DAYS`. */
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .default(sql`now()`),
  },
  (table) => ({
    /**
     * The payload columns travel together or not at all.
     *
     * Declared here as well as in the migration so the two cannot
     * drift — a constraint that exists only in the SQL is invisible to
     * `drizzle-kit generate`, which would then propose dropping it.
     *
     * Without it a partial write could leave `status='ok'` with a NULL
     * image, which the endpoint would serve as a 200 with an empty
     * body: a broken `<img>` on every surface rendering that sender,
     * with the monogram floor bypassed exactly where it is needed.
     */
    imageMatchesStatus: check(
      'domain_icons_image_matches_status_chk',
      sql`(${table.status} = 'ok' AND ${table.image} IS NOT NULL AND ${table.mime} IS NOT NULL AND ${table.source} IS NOT NULL AND ${table.contentHash} IS NOT NULL AND ${table.byteSize} IS NOT NULL) OR (${table.status} = 'none' AND ${table.image} IS NULL AND ${table.mime} IS NULL AND ${table.source} IS NULL AND ${table.contentHash} IS NULL AND ${table.byteSize} IS NULL)`,
    ),
  }),
);

export type DomainIcon = typeof domainIcons.$inferSelect;
export type NewDomainIcon = typeof domainIcons.$inferInsert;
