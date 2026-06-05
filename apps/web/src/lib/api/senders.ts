/**
 * Senders API — typed fetchers for the five Sender endpoints (D39–D46).
 *
 * Each fetcher matches the BE contract frozen for the parallel WT-B
 * backend PR (`feat/d039-senders-backend`). Wire shapes here MUST stay
 * symmetric with the BE response DTOs — when the BE PR lands and we
 * integrate, any drift between these types and the controller return
 * types is exactly the kind of mismatch the D200 / D202 envelope was
 * designed to surface at compile time.
 *
 * Privacy (D7, D228). NONE of these endpoints returns a message body,
 * HTML, attachment, or inline image. `snippet` is Gmail's short preview
 * and is the only body-adjacent string allowed. The BE controller is
 * what enforces the policy; this file documents what we expect to see
 * so an accidental schema widen on either side is loud.
 *
 * No client-side state lives here — the fetchers are pure functions
 * that the TanStack Query hooks in `features/senders/api/` call from
 * `queryFn`. Cursor pagination is opaque to the FE; we forward whatever
 * the server gave us on the previous response.
 */

import type { Envelope, PaginatedEnvelope } from '@declutrmail/shared/contracts';
import { apiGet } from './client';

// ── BE contract types (mirrors the WT-B PR) ─────────────────────────

/** Gmail-side category enum — matches `mail_senders.gmail_category`. */
export type GmailCategory = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

/** How a sender can be unsubscribed — drives the V2 unsubscribe flow (D230). */
export type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/**
 * Bucketed volume trend mirrored from `senders.types.ts:VolumeTrendBucket`.
 * Surfaces as a chip on the Senders row evidence line. Bucketed
 * (rather than raw %) to avoid false precision on small baselines —
 * see the senders-tightening brief + Codex review for context.
 *
 * Variants — see BE `VolumeTrendBucket` for the full bucket-priority
 * rules; this enum MUST stay in lock-step with the BE union:
 *   - `new`     — sender is freshly seen (wins over all other buckets)
 *   - `up`      — recent rate ≥ baseline × `UP_MULTIPLIER`
 *   - `down`    — recent rate ≤ baseline × `DOWN_MULTIPLIER`
 *   - `steady`  — within multipliers, both rates non-zero
 *   - `quiet`   — silent QUIET_DAYS..DORMANT_DAYS AND recurring
 *   - `dormant` — silent ≥ DORMANT_DAYS AND recurring
 */
export type VolumeTrendBucket = 'new' | 'up' | 'down' | 'steady' | 'quiet' | 'dormant';

/**
 * Last-review summary mirrored from `senders.types.ts:LastReview`.
 * Drives the "Last reviewed …" eyebrow on Sender Detail. `null` when
 * the engine has never produced a decision for (mailbox, sender).
 */
export interface LastReviewWire {
  /** ISO-8601 — most-recent `triage_decisions.produced_at`. */
  at: string;
  /** Engine verdict — closed enum mirroring `triage_decisions.verdict`. */
  verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
  /** Provenance — LLM call vs deterministic template fallback. */
  generatedBy: 'llm_haiku' | 'template';
  /**
   * Engine confidence, 0..1 — mirrors `triage_decisions.confidence`
   * (numeric(3,2)). Optional for backward compatibility; defaults to
   * 1.0 client-side when omitted. Drives the confidence gate in the
   * FE intent-bucketing logic (uplift-d/intent.ts).
   *
   * BE TODO: populate from the cascade result. Cascade already
   * computes this (see packages/workers/src/score-cascade.ts
   * CascadeResult.confidence). Wire it through
   * apps/api/src/senders/senders.service.ts in a follow-up PR.
   */
  confidence?: number;
}

/** Row shape on `GET /api/senders` — the list endpoint. */
export interface SenderListRow {
  id: string;
  displayName: string;
  email: string;
  domain: string;
  gmailCategory: GmailCategory;
  /** ISO-8601 — last message received. */
  lastSeenAt: string;
  /** ISO-8601 — first message received. */
  firstSeenAt: string;
  /**
   * Lifetime inbound message count for this sender, within retention
   * (ADR-0014). Powers the headline "Total" column + the magnitude bar
   * + the default `Total ↓` sort. Bigint on storage, JSON number on
   * the wire (bounded ≪ `Number.MAX_SAFE_INTEGER`). Maintained by Path
   * A on every full rebuild and reconciled nightly.
   */
  totalReceived: number;
  /**
   * "You replied N×" count (Senders V2 spec v1.3 + mig 0022) — distinct
   * outbound messages whose thread contains ≥1 inbound from this sender.
   * Auto-protect threshold is ≥3. Engine default `0` (never null).
   */
  repliedCount: number;
  /** Recent monthly cadence — most recent month's `sender_timeseries.volume`. */
  monthlyVolume: number | null;
  /**
   * Read-state proxy — `read_count / volume` for the latest month.
   * 0..1. Counts messages WITHOUT the UNREAD label (NOT email opens —
   * Gmail exposes no open events). `null` when there's no timeseries
   * row or `volume = 0`. The FE labels this as "marked read", never
   * "opened", to avoid overclaiming.
   */
  readRate: number | null;
  /** Bucketed MoM trend. `null` when there's no timeseries history. */
  volumeTrend: VolumeTrendBucket | null;
  /**
   * 12-week volume series, oldest → newest. Null when no recent
   * `mail_messages` (very old one-shot senders). Drives the per-row
   * mini-sparkline.
   */
  sparkline?: number[] | null;
  unsubscribeMethod: UnsubscribeMethod | null;
  /** Most-recent triage decision summary. `null` when never reviewed. */
  lastReview: LastReviewWire | null;
  /**
   * Standing VIP / Protect policy flags (D42, D43) — mirrors the BE
   * `SenderListRow.protectionFlags`. Present on every list row (not just
   * detail) so the Senders screen can render the "Protected" chip,
   * populate the "Protected" KPI, and route VIPs / protected senders to
   * the "Protect" intent bucket. Defaults to all-false / null when the
   * sender has no `sender_policies` row (engine default).
   */
  protectionFlags: {
    isVip: boolean;
    isProtected: boolean;
    protectionReason: ProtectionReasonWire | null;
    protectionSetAt: string | null;
  };
}

/**
 * Why a sender is protected. Mirrors the BE `protection_reason` enum
 * (see `apps/api/src/senders/senders.types.ts`):
 *   - `user_defined` — founder toggled Protect on
 *   - `engagement_based` — engagement signals pinned the sender
 *   - `vip` — protection inherited from VIP status
 *   - `null` — not protected
 */
export type ProtectionReasonWire = 'user_defined' | 'engagement_based' | 'vip';

/**
 * Detail shape on `GET /api/senders/:id` — extends the list row with
 * the protection-flag block. VIP and Protect are separate user-driven
 * policies (D42 / D43); both are mutually independent of each other.
 *
 * Field names mirror the BE source-of-truth (`SenderDetail.protectionFlags`
 * in `apps/api/src/senders/senders.types.ts`). Drift between FE and BE
 * shapes is silently swallowed by TypeScript when this type narrows on a
 * non-existent field — keep them in lockstep.
 */
export interface SenderDetailDto extends SenderListRow {
  protectionFlags: {
    isVip: boolean;
    isProtected: boolean;
    /** Why the sender is protected — null when `isProtected` is false. */
    protectionReason: ProtectionReasonWire | null;
    /** ISO-8601 — when protection was last set. Null when not protected. */
    protectionSetAt: string | null;
  };
}

/** Row shape on `GET /api/senders/:id/messages` — the recent-messages list. */
export interface MailMessageRow {
  id: string;
  providerMessageId: string;
  providerThreadId: string;
  subject: string;
  /** Gmail snippet — the ONLY body-adjacent string allowed (D7). */
  snippet: string;
  /** ISO-8601 — Gmail `internalDate`. */
  internalDate: string;
  isUnread: boolean;
}

/** Row shape on `GET /api/senders/:id/timeseries` — 12-month volume + read counts. */
export interface TimeseriesPointDto {
  /** First-of-month ISO date (YYYY-MM-DD). */
  yearMonth: string;
  volume: number;
  readCount: number;
}

/**
 * One sender row inside a Weekly Hero slice card (D47, D48).
 *
 * Compact shape — the full `SenderListRow` is overkill for the slice
 * cards (which render avatar dot + name + monthly volume + sparkline).
 * Kept narrow so the hero envelope stays small (3 slices × ≤ 24 rows
 * × 12-int sparklines).
 *
 * `sparkline` is exactly 12 numbers in chronological order (oldest →
 * newest). Months with no `sender_timeseries` row are filled with 0
 * by the BE so the FE doesn't need alignment logic.
 */
export interface WeeklyHeroSenderDto {
  id: string;
  displayName: string;
  email: string;
  domain: string;
  monthlyVolume: number;
  readRate: number | null;
  sparkline: number[];
}

/** Slice kind on the Weekly Hero (D47, D48). */
export type WeeklyHeroSliceKind = 'high_confidence' | 'spike' | 'quiet';

/** One Hero slice card (D47, D48). `senders` is capped at 24 by the BE. */
export interface WeeklyHeroSliceDto {
  kind: WeeklyHeroSliceKind;
  /** Pre-cap total — drives "+N more" copy when totalCount > senders.length. */
  totalCount: number;
  senders: WeeklyHeroSenderDto[];
}

/**
 * Response shape on `GET /api/senders/weekly-hero` (D47, D48).
 *
 * `isMonday` is true on Mondays in the mailbox's local timezone — the
 * FE shows the Hero only when true; on other days it hides the Hero
 * and renders the grid/table directly. Slices with < 3 senders are
 * OMITTED by the BE (D48 empty-card guard); the FE iterates returned
 * slices unconditionally.
 */
export interface WeeklyHeroDto {
  isMonday: boolean;
  /** YYYY-MM-DD — Monday of the current week (mailbox-local). */
  weekOf: string;
  slices: WeeklyHeroSliceDto[];
}

/** GET /api/senders/weekly-hero — Weekly Hero slices (D47, D48). */
export function fetchWeeklyHero(signal?: AbortSignal): Promise<Envelope<WeeklyHeroDto, unknown>> {
  return apiGet<WeeklyHeroDto>('/api/senders/weekly-hero', { signal });
}

/**
 * Minimal-shape suggestion row for the `/senders/suggest` typeahead.
 * Lighter than `SenderListRow` by design — the dropdown only needs
 * enough to render one line per match.
 */
export interface SenderSuggestionDto {
  id: string;
  name: string;
  email: string;
  domain: string;
  totalReceived: number;
}

/**
 * GET /api/senders/suggest — typeahead autocomplete (autosuggest).
 * Mailbox-scoped; ranked by `total_received DESC` so the biggest
 * matches surface first. Empty / whitespace query → empty array.
 */
export function fetchSenderSuggestions(
  q: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<Envelope<{ senders: SenderSuggestionDto[] }, unknown>> {
  const query: Record<string, string> = { q };
  if (options.limit !== undefined) query.limit = String(options.limit);
  return apiGet<{ senders: SenderSuggestionDto[] }>('/api/senders/suggest', {
    query,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

/**
 * Mailbox-wide aggregates for `GET /api/senders/summary` (#145, rolling-
 * window rewrite). Returns the totals the Senders screen's hero, KPI
 * strip, and chips read so every headline number is a server-resolved
 * truth over the WHOLE mailbox — never a per-page sum.
 *
 * Eight mutually-exclusive buckets in priority order; the SQL CASE in
 * the BE service and the FE bucketing logic both consume the SAME
 * `BUCKET_PRIORITY` from `@declutrmail/shared/senders`, so chip / row /
 * KPI counts cannot disagree (CLAUDE.md §8 invariant).
 */
export interface SenderSummaryDto {
  /** Lifetime distinct senders within retention. */
  totalSenders: number;
  /** Senders with ≥1 inbound msg in last 30 days. */
  activeSenders: number;
  /** Inbound msg count in last 30 days (mailbox-wide). */
  last30dVolume: number;
  /** 0..100 integer percent — share of `last30dVolume` from senders in
   *  the `needs_review` bucket. */
  noiseReducible: number;
  /** Alias of `byBucket.protect` (matches the KPI cell label). */
  protected: number;
  /** Alias of `byBucket.needs_review`. */
  needsReview: number;
  /** Per-bucket sender counts. Sum equals `totalSenders`. */
  byBucket: {
    one_time: number;
    protect: number;
    people: number;
    needs_review: number;
    quiet: number;
    dormant: number;
    bulk: number;
    other: number;
  };
  /** ISO-8601 — server time at compute. */
  asOf: string;
}

/**
 * GET /api/senders/summary — mailbox-wide aggregates (#145).
 *
 * `q` honors the active search; `includeOneTime` pivots the whole
 * summary so the FE one-time toggle hides ~62% of typical noise without
 * the chip counts going out of sync with the visible rows.
 */
export function fetchSendersSummary(
  params: { q?: string | undefined; includeOneTime?: boolean | undefined } = {},
  signal?: AbortSignal,
): Promise<Envelope<SenderSummaryDto, unknown>> {
  return apiGet<SenderSummaryDto>('/api/senders/summary', {
    query: {
      q: params.q ? params.q : undefined,
      includeOneTime: params.includeOneTime === false ? 'false' : undefined,
    },
    signal,
  });
}

/** Row shape on `GET /api/senders/:id/history` — decision-history rows. */
export interface DecisionHistoryRowDto {
  id: string;
  /**
   * Closed enum mirroring `triage_decision.verdict`. "screen" is an
   * INTERNAL enum (D227); the BE filters those out so the FE never
   * sees them — but the wire type lists only the four user-facing
   * verdicts to keep the contract narrow.
   */
  verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
  /** Engine confidence, 0..1. */
  confidence: number;
  /** ISO-8601. */
  producedAt: string;
  /** One-sentence rationale. */
  reasoning: string;
  /**
   * How the decision was produced — LLM (Haiku) vs deterministic
   * template. Mirrors the BE `triage_reasoning_source` enum: the value
   * is `'llm_haiku'`, NOT `'llm'`. (An earlier `'llm'` literal here
   * never matched the wire — the decision-timeline source label rendered
   * blank for every LLM-generated decision.)
   */
  generatedBy: 'llm_haiku' | 'template';
}

// ── Fetchers ────────────────────────────────────────────────────────

/**
 * Sortable column for `GET /api/senders` (ADR-0014, senders list
 * contract). Slice 1 BE implements `total | last_seen | first_seen |
 * name`; `read | recommended` are reserved but deferred (the BE
 * returns 400 for either). When omitted, the BE defaults to `total`.
 */
export type SenderListSort = 'total' | 'last_seen' | 'first_seen' | 'name' | 'read' | 'recommended';

/** Sort direction. When omitted, the BE picks a sane default per sort. */
export type SenderListDirection = 'asc' | 'desc';

export interface ListSendersParams {
  category?: GmailCategory | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  /**
   * Tri-state standing-protected filter (D38). `true` = only protected;
   * `false` = exclude protected; omit = no constraint. Maps to wire
   * `?protected=true` / `?protected=not`. ADR-0014 + senders list
   * contract.
   */
  isProtected?: TriStateFilter | undefined;
  /** Sortable column. Omit to take the BE default (`total`). */
  sort?: SenderListSort | undefined;
  /** Sort direction. Omit to take the BE's sane per-sort default. */
  direction?: SenderListDirection | undefined;
  /**
   * Server-side search (#145) — case-insensitive substring over name /
   * email / domain, mailbox-wide. Maps to `?q=`. Omit/empty = no search.
   */
  q?: string | undefined;
  /**
   * D38 activity bucket — `active | quiet | dormant`. Use the special
   * `not-active | not-quiet | not-dormant` form on the wire to negate.
   * Omit = no constraint.
   */
  activity?: ActivityBucket | undefined;
  /** When true, send the negated form of `activity` on the wire. */
  activityNegate?: boolean | undefined;
  /**
   * D38 unsub-readiness tri-state. `true` = require unsubscribe method
   * present; `false` = exclude; omit = no constraint.
   */
  unsubReady?: TriStateFilter | undefined;
  /** D38 — "quiet for N days+" filter. 30 / 90 / 180 / 365 + raw number. */
  windowDays?: number | undefined;
  /** D38 — case-insensitive domain substring (mailbox-wide). */
  domain?: string | undefined;
}

/**
 * `meta.query` block returned on every page of `GET /api/senders`
 * (ADR-0014, senders list contract). Page 1's value is authoritative
 * for the duration of a scroll — the FE preserves page-1's snapshot
 * client-side and does NOT animate counts on subsequent pages.
 */
export interface SenderListQueryMeta {
  /** Rows matching the active filter + search (query-wide; NOT cursor-scoped). */
  totalMatching: number;
  /**
   * `MAX(total_received)` for the active mailbox, UNFILTERED. Drives
   * the magnitude-bar denominator — a filtered view does NOT rescale
   * to its own max, so bars stay comparable across filters.
   */
  globalMaxTotal: number;
  /** Optional per-chip counts for the filter UI (Slice 3); omitted today. */
  counts?: Record<string, number>;
  /**
   * D38 powerful filters — mailbox-wide absolute counts per axis,
   * stable across the active compose (ignores other filter axes). The
   * compose strip's chip counts use this so picking a chip is
   * predictable: numbers don't shift under the user's cursor.
   */
  filterCounts?: {
    total: number;
    active: number;
    quiet: number;
    dormant: number;
    unsubReady: number;
    repliedTo: number;
    protected: number;
  };
  /** ISO-8601 — when the meta was computed server-side (observational). */
  asOf: string;
}

/**
 * Activity bucket (D38). Mirrors the BE `ActivityBucket` union.
 * Mutually exclusive — exactly one bucket per sender at any moment.
 */
export type ActivityBucket = 'active' | 'quiet' | 'dormant';

/**
 * Tri-state filter — required / negated / absent. Mirrors the BE
 * `TriStateFilter`. `true` = include only matches; `false` = exclude
 * matches (NOT this); `null` = no constraint.
 */
export type TriStateFilter = boolean | null;

/**
 * Paginated envelope variant that also carries the `meta.query` block —
 * the senders list contract's wider shape. The shared
 * `PaginatedEnvelope` doesn't accept extra meta keys, so the senders
 * surface declares its own envelope here.
 */
export interface SenderListEnvelope {
  data: SenderListRow[];
  meta: {
    pagination: PaginatedEnvelope<SenderListRow>['meta']['pagination'];
    query: SenderListQueryMeta;
  };
}

/** GET /api/senders — paginated sender list (D39, ADR-0014). */
export function fetchSenders(
  params: ListSendersParams = {},
  signal?: AbortSignal,
): Promise<SenderListEnvelope> {
  return apiGet<SenderListRow[]>('/api/senders', {
    query: {
      category: params.category,
      limit: params.limit,
      cursor: params.cursor,
      // D38 — tri-state protected: 'true' / 'not' / omitted. The BE
      // accepts both 'not' and 'false' forms; we send 'not' so the
      // wire reads as the compose-strip negation primitive.
      protected:
        params.isProtected === true ? 'true' : params.isProtected === false ? 'not' : undefined,
      sort: params.sort,
      direction: params.direction,
      // Empty string collapses to omitted so a cleared search keys the
      // same cache entry as "no search".
      q: params.q ? params.q : undefined,
      // D38 compose strip params.
      activity: params.activity
        ? params.activityNegate
          ? `not-${params.activity}`
          : params.activity
        : undefined,
      unsub_ready:
        params.unsubReady === true ? 'true' : params.unsubReady === false ? 'not' : undefined,
      window: params.windowDays !== undefined ? String(params.windowDays) : undefined,
      domain: params.domain ? params.domain : undefined,
    },
    signal,
  }) as Promise<SenderListEnvelope>;
}

/** GET /api/senders/:id — single sender detail (D40). */
export function fetchSenderDetail(
  id: string,
  signal?: AbortSignal,
): Promise<Envelope<SenderDetailDto, unknown>> {
  return apiGet<SenderDetailDto>(`/api/senders/${encodeURIComponent(id)}`, { signal });
}

export interface ListSenderMessagesParams {
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** GET /api/senders/:id/messages — paginated recent messages (D41, D46). */
export function fetchSenderMessages(
  id: string,
  params: ListSenderMessagesParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<MailMessageRow>> {
  return apiGet<MailMessageRow[]>(`/api/senders/${encodeURIComponent(id)}/messages`, {
    query: { limit: params.limit, cursor: params.cursor },
    signal,
  }) as Promise<PaginatedEnvelope<MailMessageRow>>;
}

/** GET /api/senders/:id/timeseries — fixed 12-month window, no pagination (D45). */
export function fetchSenderTimeseries(
  id: string,
  signal?: AbortSignal,
): Promise<Envelope<TimeseriesPointDto[], unknown>> {
  return apiGet<TimeseriesPointDto[]>(`/api/senders/${encodeURIComponent(id)}/timeseries`, {
    signal,
  });
}

export interface ListSenderHistoryParams {
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** GET /api/senders/:id/history — paginated decision history (D46). */
export function fetchSenderHistory(
  id: string,
  params: ListSenderHistoryParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<DecisionHistoryRowDto>> {
  return apiGet<DecisionHistoryRowDto[]>(`/api/senders/${encodeURIComponent(id)}/history`, {
    query: { limit: params.limit, cursor: params.cursor },
    signal,
  }) as Promise<PaginatedEnvelope<DecisionHistoryRowDto>>;
}
