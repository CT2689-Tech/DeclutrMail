import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

import { bytea } from './_custom-types';

/**
 * Brand icon cache (ADR-0034).
 *
 * ONE row per canonical brand domain, for the WHOLE product. Not per user,
 * not per mailbox — see the privacy note below, which is the reason
 * this table looks the way it does.
 *
 * Populated by `DomainIconWorker` (batchPolicy, idempotency key =
 * domain) and read by `GET /api/icons/:domain`. A logo is a property
 * of a domain, not of anyone's relationship to it, so 4,000 users who
 * all receive mail from Chase share ONE row and ONE bounded resolution
 * cascade per cache TTL.
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
 * fetch forever. Absence, TTL expiry, or an older resolver version
 * enqueues work; a current fresh negative does not.
 */
export const domainIconStatus = pgEnum('domain_icon_status', ['ok', 'none']);

/**
 * Where an `ok` image came from — provenance for attribution + coverage review.
 * `vendor` is the legacy DB label for official-website normalized rasters.
 * `brandfetch` stays distinct because its cached artwork must refresh
 * on the provider's shorter 30-day term (ADR-0034 §4c).
 */
export const domainIconSource = pgEnum('domain_icon_source', ['bimi', 'vendor', 'brandfetch']);

/** Refresh horizons (ADR-0034 §2), applied by the worker at write time. */
export const DOMAIN_ICON_TTL_DAYS = {
  /** A stored mark goes stale in 90d so rebrands eventually land. */
  ok: 90,
  /** Brandfetch permits cached artwork for at most 30 days. */
  brandfetch: 30,
  /** A miss is retried after 30d so newly-published BIMI records land. */
  none: 30,
} as const;

/**
 * Version of the resolution cascade that produced a cache row.
 * Increment when a new source or acceptance rule can turn an old
 * negative into a mark. Hits remain valid across resolver upgrades;
 * only older misses are retried immediately.
 *
 * 7 — Brandfetch was bound to the production worker. The tier had never
 * run there: the worker builds its deps as
 * `...(brandfetchApiKey ? { brandfetch } : {})`, and the key was absent
 * from the deploy, so every v6 negative verdict in production was
 * reached by BIMI and website scraping alone. Those verdicts are
 * therefore not evidence that a domain has no logo — they are evidence
 * that two of three sources missed it, which is why amazon.com,
 * linkedin.com, google.com and usps.com all sat at `status = 'none'`.
 *
 * Without this bump, binding the key changes nothing for a month:
 * `none` rows carry a 30-day TTL and these were written 2026-08-17/18
 * AT v6, so `isStale` would keep answering false and the new tier would
 * never be asked. The bump is what makes the key take effect — and it
 * is exactly what this constant is for.
 */
export const DOMAIN_ICON_RESOLVER_VERSION = 7;

export const domainIcons = pgTable(
  'domain_icons',
  {
    /**
     * Canonical brand domain, lowercased — `chase.com`, never
     * `alertsp.chase.com`. Producers derive the Public-Suffix-List
     * organizational domain and then apply only fully verified aliases
     * such as `temuemail.com -> temu.com`, so a brand's sending domains
     * collapse to one row (and one resolution run per cache TTL).
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
     * BIMI stores SVG verbatim (post-sanitization): vector, a few KB,
     * and scalable to every avatar size. Official-site artwork is
     * normalized to PNG before it lands here.
     * `bytea` rather than `text` lets raster and SVG share the column.
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

    /** Resolution cascade version; older negative rows are provisional. */
    resolverVersion: integer('resolver_version').notNull().default(DOMAIN_ICON_RESOLVER_VERSION),

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
