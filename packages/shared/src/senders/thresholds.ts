// packages/shared/src/senders/thresholds.ts
//
// Single source of truth for every threshold the Senders surface
// applies — confidence gates, window sizes, bucket cutoffs, and the
// internal "person" score weights.
//
// Why one file? Pre-#145 the 0.75 confidence gate lived in TWO places
// (apps/web/.../uplift-d/intent.ts:ENGINE_CONFIDENCE_GATE + the SQL
// CASE inside apps/api/.../getSenderSummary), and the trend bucket
// thresholds drifted across files. Centralising here means the
// founder edits ONE constant and every surface — list + summary +
// chips + KPI strip + tests — picks up the change.
//
// CONVENTIONS:
//   - Values that are user-facing (window sizes the user sees in copy)
//     live in `WINDOWS`. Founder/PM tunable.
//   - Values that gate engine output (confidence) live in `CONFIDENCE`.
//   - Score weights live in `SCORE` and are INTERNAL — never exposed
//     in any user setting. Tuned by us, not by the user.
//   - Window thresholds are days (`Days`-suffixed); confidence is 0..1
//     numeric; weights are integers.
//
// IMPORT FROM:
//   - apps/web/src/features/senders/uplift-d/intent.ts  (FE bucketing)
//   - apps/api/src/senders/senders.read-service.ts      (BE SQL interpolation)
//   - apps/web/src/features/senders/senders-screen.tsx  (chip rendering)
//
// BE NOTE: when interpolating into raw SQL (`sql`...``), use template
// substitution to keep values bound parameters when possible. The
// integer days fields are safe to interpolate as literals.

/**
 * Activity / lifecycle windows. ALL anchored to `now - N days`
 * (rolling), never calendar-month — eliminates month-boundary cliffs
 * (the "everyone Dormant on day 1 of new month" bug).
 */
export const WINDOWS = {
  /** "Active sender" = at least 1 inbound msg in last N days. */
  ACTIVE_DAYS: 30,

  /** "People activity" = at least 1 inbound msg in last N days
   *  (looser than ACTIVE so a quiet personal contact still qualifies). */
  PEOPLE_ACTIVITY_DAYS: 90,

  /** Volume window for per-row "last 30d" display + KPI totalMonthly. */
  VOLUME_DAYS: 30,

  /** Velocity comparison — recent N days. */
  TREND_RECENT_DAYS: 30,
  /** Velocity baseline — `[now - BASELINE_END, now - BASELINE_START]` so the
   *  baseline excludes the recent window and uses the prior period for
   *  the up/down ratio. With 30 + [30,90], baseline = days 30→90 ago. */
  TREND_BASELINE_START_DAYS: 30,
  TREND_BASELINE_END_DAYS: 90,

  /** "New" = `first_seen_at >= now - N`. Wins priority over Quiet/Dormant. */
  NEW_DAYS: 30,
  /** "Quiet" = `last_seen_at` is between `[now - QUIET_DAYS,
   *  now - NEW_DAYS)`. Recurring senders only (≥ RECURRING_MIN_TOTAL). */
  QUIET_DAYS: 60,
  /** "Dormant" = `last_seen_at < now - DORMANT_DAYS`. Recurring only. */
  DORMANT_DAYS: 180,
} as const;

/**
 * Engine confidence gates — used by FE intent bucketing + BE summary
 * aggregates so the row's bucket and the chip count NEVER disagree
 * (CLAUDE.md §8 invariant: row/chip/KPI must agree).
 */
export const CONFIDENCE = {
  /** Below this, an engine verdict stays in the catch-all bucket — the
   *  engine isn't confident enough to surface a recommendation. */
  GATE: 0.75,
  /** Bar for the "Needs review" KPI/chip. May diverge from GATE later
   *  if we want a stricter actionability bar. Keep equal at launch. */
  NEEDS_REVIEW_GATE: 0.75,
  /** Bar for the Weekly Hero "high confidence" slice — stricter than
   *  the per-row gate. Only the cleanest engine recommendations surface
   *  in the hero so a one-glance review can be trusted. */
  WEEKLY_HERO_HIGH_GATE: 0.85,
} as const;

/**
 * Volume thresholds — distinguish recurring relationships from
 * one-shot noise (receipts, confirmations, one-time signups).
 */
export const VOLUMES = {
  /** ≤ this lifetime msg count → `one-time` bucket. ~62% of typical
   *  mailbox falls here; hidden behind an explicit toggle by default. */
  ONE_TIME_MAX_TOTAL: 2,
  /** ≥ this lifetime msg count → eligible for `quiet`/`dormant`. */
  RECURRING_MIN_TOTAL: 3,
  /** "Needs review" requires at least N inbound msgs in the active
   *  window — kills the noise of single-msg dormant cleanup recs. */
  NEEDS_REVIEW_MIN_RECENT_MSGS: 1,
} as const;

/**
 * Velocity bucket multipliers — `up/down/steady` comparison.
 * `recent_rate ≥ up_multiplier × baseline_rate` → up
 * `recent_rate ≤ down_multiplier × baseline_rate` → down
 * else → steady.
 *
 * Rates are per-day (msgs / window-days) so the recent (30d) and
 * baseline (60d span) windows are normalised before comparison.
 */
export const TREND = {
  UP_MULTIPLIER: 1.3,
  DOWN_MULTIPLIER: 0.7,
  /** Weekly Hero "spike" slice — current-month volume ≥ N × prior 3-month
   *  average (with a non-trivial baseline). Stricter than UP_MULTIPLIER
   *  so the hero surfaces only true spikes, not gentle upticks. */
  WEEKLY_HERO_SPIKE_RATIO: 3,
  /** Weekly Hero "quiet" slice — read-rate cutoff. Below this rate, the
   *  sender is treated as low-engagement noise even if still active. */
  WEEKLY_HERO_QUIET_READ_RATE_MAX: 0.3,
} as const;

/**
 * Person-score additive weights. INTERNAL — never user-tunable. Tuned
 * by us based on signal strength against real mailboxes (see
 * `docs/decisions/0017-sender-bucketing-redesign.md` for the rationale).
 *
 * Score evaluated for every sender; bucket assignment uses the
 * threshold in `PERSON_SCORE_THRESHOLD`.
 *
 * Priority order in the bucket assignment is enforced separately — see
 * `BUCKET_PRIORITY` below.
 */
export const SCORE = {
  /** User has replied (≥1 outbound msg to this email). Strongest
   *  bidirectional signal — if the user took time to respond, the
   *  sender is in their life regardless of other signals. */
  REPLIED_WEIGHT: 5,
  /** Domain in the free-mail provider allowlist (gmail/outlook/...). */
  FREE_MAIL_WEIGHT: 3,
  /** Domain matches the user's own email domain (likely coworker). */
  OWN_DOMAIN_WEIGHT: 3,

  /** Has List-Unsubscribe header (one_click or mailto) — strongest
   *  "definitely bulk" signal. RFC 8058 requires this for legitimate
   *  bulk senders; personal email almost never carries it. */
  HAS_UNSUB_HEADER_WEIGHT: -5,
  /** Local part is a role-prefix (`noreply@`, `notifications@`, etc.). */
  ROLE_PREFIX_WEIGHT: -4,
  /** Hostname is a bulk-mail subdomain (`em.brand.com`, `mail.x.com`). */
  BULK_SUBDOMAIN_WEIGHT: -3,

  /** Threshold for `people` bucket assignment. `score >= this` → person. */
  PERSON_SCORE_THRESHOLD: 3,
} as const;

/**
 * Free-mail provider domains — strong "real person" signal. Add to
 * the list as new providers surface (Tutanota, Mailbox.org, regional
 * providers). Order does not matter — the FE/SQL does a set lookup.
 *
 * Exposed as a JS array (not Set) so it's trivially interpolable into
 * raw SQL via `ANY(ARRAY[...])`.
 */
export const FREE_MAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'hotmail.com',
  'protonmail.com',
  'proton.me',
  'pm.me',
  'fastmail.com',
  'fastmail.fm',
  'gmx.com',
  'gmx.net',
  'aol.com',
  'live.com',
  'me.com',
  'mac.com',
  'tutanota.com',
  'mailbox.org',
  'zoho.com',
] as const;

/**
 * Regex sources for the "definitely bulk" patterns. Keep as STRINGS so
 * the SQL side can interpolate via `~*` and the JS side can compile
 * via `new RegExp(..., 'i')`. Editing one pattern updates both sides.
 *
 * Patterns are tuned against real-mailbox samples — extend cautiously,
 * each pattern can mis-classify a real personal email if too broad.
 */
export const PATTERNS = {
  /** Local-part role prefix (case-insensitive). Anchor `^` matches the
   *  start of the email; `@` ends the LP. */
  ROLE_PREFIX_LP_REGEX:
    '^(no.?reply|do.?not.?reply|notifications?|alerts?|news|updates?|email|reply|mailer?|noticias)@',
  /** Hostname contains a bulk-mail subdomain (`em.`, `e1.`, `m.`,
   *  `mail.`, `email.`, `news.`, `notify.`, `alerts.`, `updates.`,
   *  `mailer.`). Allows one optional sub-segment before the bulk
   *  marker (e.g. `welcome.email.brand.com`). */
  BULK_SUBDOMAIN_REGEX:
    '@([a-z0-9]+\\.)?(em|e1|e2|m|mail|email|news|notify|notification|alerts?|updates?|mailer|messaging|messages|smtp|delivery)\\.[a-z0-9-]+\\.[a-z]{2,}$',
} as const;

/**
 * The eight buckets the Senders screen surfaces. Priority order is
 * enforced in `BUCKET_PRIORITY` — first match wins, so a sender
 * matches exactly ONE bucket. Counts across the eight sum to the
 * total sender count.
 *
 * The product UI also exposes a hidden `one_time` slice (lifetime ≤
 * `ONE_TIME_MAX_TOTAL`) revealed by an explicit toggle.
 */
export type SenderBucket =
  'one_time' | 'protect' | 'people' | 'needs_review' | 'quiet' | 'dormant' | 'bulk' | 'other';

/**
 * Bucket assignment priority — first match wins. The SQL CASE in
 * `getSenderSummary` enumerates clauses in this exact order; the FE
 * `bucketOf()` helper mirrors it. Drift between the two = chip/row
 * disagreement (the bug CLAUDE.md §8 calls out).
 *
 * Reading top-to-bottom:
 *   1. one_time   — total ≤ 2 lifetime msgs (noise floor, hidden default)
 *   2. protect    — explicit user marking (is_protected OR is_vip)
 *   3. people     — score ≥ threshold (replied / free-mail / own-domain
 *                   minus bulk signals)
 *   4. needs_review — engine: cleanup/later verdict at confidence ≥ gate
 *                     AND active in last 30d (don't surface stale recs)
 *   5. quiet      — silent 60-180d AND recurring
 *   6. dormant    — silent ≥180d AND recurring
 *   7. bulk       — has any bulk signal but no recommendation
 *   8. other      — everything else (uncategorised — needs manual look)
 */
export const BUCKET_PRIORITY: readonly SenderBucket[] = [
  'one_time',
  'protect',
  'people',
  'needs_review',
  'quiet',
  'dormant',
  'bulk',
  'other',
] as const;

/**
 * Lifecycle / velocity sub-buckets for the per-row trend chip. Computed
 * INDEPENDENTLY of the main bucket above — a `people` sender can still
 * be `up` or `down` in velocity; the trend chip surfaces alongside the
 * bucket. NULL when the sender has no signal at all (one-shot ancient).
 */
export type VelocityBucket = 'new' | 'up' | 'down' | 'steady' | 'quiet' | 'dormant';
