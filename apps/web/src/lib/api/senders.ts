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

import type {
  Envelope,
  PaginatedEnvelope,
  UnsubscribeLifecycleStatus,
} from '@declutrmail/shared/contracts';
import { apiGet, apiPatch, apiPost } from './client';

// ── BE contract types (mirrors the WT-B PR) ─────────────────────────

/** Gmail-side category enum — derived from `gmail_category` pg_enum via
 * the shared contracts package. */
export type { GmailCategory } from '@declutrmail/shared/contracts';
import type { GmailCategory } from '@declutrmail/shared/contracts';

/** How a sender can be unsubscribed — drives the V2 unsubscribe flow (D230). */
export type UnsubscribeMethod = 'one_click' | 'mailto' | 'none';

/** Truthful one-click/manual/unavailable unsubscribe lifecycle (D9/D245). */
export type UnsubStatus = UnsubscribeLifecycleStatus;

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
  /**
   * Whether a brand mark for this domain is cached server-side right
   * now (ADR-0034). Drives `Avatar`'s `hasMark` — the logo layer is a
   * CSS `background-image`, so this is the page's only chance to avoid
   * a request that would come back 204.
   */
  brandMark: boolean;
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
   * Messages currently carrying INBOX for this sender — what the
   * inbox-scoped verbs can actually reach (ADR-0028 companion surface).
   * Optional: an API predating the field omits it (deploy skew) and
   * legacy fixtures don't carry it; absent ⇒ the UI shows nothing
   * rather than a fabricated 0.
   */
  inboxCount?: number | null;
  /**
   * The UNREAD subset of `inboxCount` — for a Protected sender, what
   * the protection is shielding from bulk and automatic cleanup (D245).
   * Optional for the same deploy-skew reason as `inboxCount`: absent ⇒
   * show nothing rather than a fabricated 0, which would read as
   * "shielding nothing" and is the opposite of the truth.
   */
  unreadInboxCount?: number | null;
  /**
   * "You wrote to them N×" count (mig 0063) — distinct outbound
   * messages ADDRESSED to this sender (their address in To or Cc).
   * Not a reply count: Gmail exposes no causal reply signal, and the
   * thread-membership proxy that stood in for one credited a bounce
   * notifier with 14 replies (F010). Automatic protection needs this
   * >= 3 AND at least one message received from them. Engine default
   * `0` (never null).
   */
  wroteToCount: number;
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
  /** Standing protection state for destructive and automatic-action gates. */
  protectionFlags: {
    isProtected: boolean;
    protectionReason: ProtectionReasonWire | null;
    protectionSetAt: string | null;
    /**
     * Does the recorded reason still hold against today's evidence?
     *
     * Only `replied` can go stale (mig 0063 corrected what it counts).
     * `false` means SURFACE IT — nothing has been unprotected; the sweep
     * never withdraws a correspondence shield. `null` means the mailbox
     * has no outbound mail indexed, so the rule is unmeasurable rather
     * than failed, and MUST render exactly as `true`.
     *
     * Optional because an API pod predating the field omits it, and
     * `undefined` is likewise "no claim" — never "unsupported".
     */
    protectionEvidenceCurrent?: boolean | null;
  };
  /**
   * Standing policy verb (`keep | archive | unsubscribe | later`).
   * `null` = no policy row (engine default). FE renders a "Unsub queued"
   * pill when this equals `'unsubscribe'` (D38 2026-06-05 brainstorm).
   *
   * Optional on the type because legacy test fixtures + Weekly-Hero
   * wire shapes don't carry it; absent ⇒ adapter treats as `null`.
   */
  policyType?: 'keep' | 'archive' | 'unsubscribe' | 'later' | null;
  /**
   * Truthful unsubscribe lifecycle (D9/D245) — see `UnsubStatus`.
   * Endpoint acceptance, manual Gmail progress, failure, uncertainty,
   * and unavailable channels remain distinct. Optional for fixture
   * compatibility; absent ⇒ `null`.
   */
  unsubStatus?: UnsubStatus | null;
}

/**
 * Why a sender is protected. Mirrors the BE `protection_reason` enum
 * (see `apps/api/src/senders/senders.types.ts`):
 *   - `user_defined` — the user toggled Protect on
 *   - `replied` — two-way correspondence: >=3 messages addressed to them and >=1 from them
 *   - `starred` — the user starred a message in the past year
 *   - `gmail_important` — Gmail marked at least three recent messages important and the sender is in Primary
 *   - `null` — not protected
 */
export type ProtectionReasonWire = 'user_defined' | 'replied' | 'starred' | 'gmail_important';

/**
 * Detail shape on `GET /api/senders/:id` — extends the list row with
 * the protection-flag block.
 *
 * Field names mirror the BE source-of-truth (`SenderDetail.protectionFlags`
 * in `apps/api/src/senders/senders.types.ts`). Drift between FE and BE
 * shapes is silently swallowed by TypeScript when this type narrows on a
 * non-existent field — keep them in lockstep.
 */
export interface SenderDetailDto extends SenderListRow {
  protectionFlags: {
    isProtected: boolean;
    /** Why the sender is protected — null when `isProtected` is false. */
    protectionReason: ProtectionReasonWire | null;
    /** ISO-8601 — when protection was last set. Null when not protected. */
    protectionSetAt: string | null;
    /**
     * Does the recorded reason still hold against today's evidence?
     *
     * Only `replied` can go stale (mig 0063 corrected what it counts).
     * `false` means SURFACE IT — nothing has been unprotected; the sweep
     * never withdraws a correspondence shield. `null` means the mailbox
     * has no outbound mail indexed, so the rule is unmeasurable rather
     * than failed, and MUST render exactly as `true`.
     *
     * Optional because an API pod predating the field omits it, and
     * `undefined` is likewise "no claim" — never "unsupported".
     */
    protectionEvidenceCurrent?: boolean | null;
  };
  /**
   * Raw `mailto:` URL from the sender's List-Unsubscribe header —
   * D230's manual path. The page renders a Gmail compose deep link
   * built from it (the USER sends; never auto-sent). Null unless
   * `unsubscribeMethod === 'mailto'`. Optional for fixture compat.
   */
  unsubscribeMailtoUrl?: string | null;
  /**
   * The engine's current read on this sender — rendered as the optional
   * suggestion disclosure below the action toolbar (D39, D245).
   *
   * It is NOT what highlights a verb: `derivePrimaryVerbId` picks that
   * from observed facts alone, and the two are allowed to disagree. The
   * disclosure exists so a user can see the engine's read when they do.
   *
   * `scoredAt` is shown because re-scoring is trigger-driven against a
   * 7-day TTL — most stored verdicts are older than that, and a
   * suggestion that hides its age would be the same class of untruth
   * this surface just shed. Optional for fixture compat.
   */
  recommendation?: {
    verdict: 'keep' | 'archive' | 'unsubscribe' | 'later';
    confidence: number;
    reasoning: string;
    generatedBy: 'llm_haiku' | 'template';
    /** ISO-8601 — when the engine last looked at this sender. */
    scoredAt: string;
    /** Past its TTL. The page asks for a fresh read; it still shows this one. */
    stale: boolean;
  } | null;
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
  /**
   * Whole-message byte estimate from Gmail `sizeEstimate` (D7
   * amendment per ADR-0021). `null` for rows synced before the
   * amendment OR rows where Gmail omitted the field; the renderer
   * shows an em-dash on null rather than "0B".
   */
  sizeBytes: number | null;
}

/** Row shape on `GET /api/senders/:id/timeseries` — 12-month volume + read counts. */
export interface TimeseriesPointDto {
  /** First-of-month ISO date (YYYY-MM-DD). */
  yearMonth: string;
  volume: number;
  readCount: number;
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

/**
 * Row shape on `GET /api/senders/:id/history` — one action that was
 * actually taken on this sender, from `activity_log`.
 *
 * NOT the engine's suggestion. A previous version of this endpoint
 * served `triage_decisions` rows, which made every scored-but-untouched
 * sender claim a decision the user never made. The suggestion has no
 * field on this wire contract today — when it gets one it renders
 * through `RecommendationBanner`, labelled as a suggestion, never as a
 * row in this list.
 */
export interface DecisionHistoryRowDto {
  /** `activity_log.id` — the operation id shown on the row. */
  id: string;
  /**
   * Closed enum mirroring the DECISION subset of `activity_log.action`:
   * the K/A/U/L/D verbs plus the Protect toggles. Unsubscribe lifecycle
   * outcomes and followup dismissals stay in the Activity feed.
   */
  action:
    | 'keep'
    | 'archive'
    | 'unsubscribe'
    | 'later'
    | 'delete'
    | 'marked_protected'
    | 'unmarked_protected';
  /** Mirrors `activity_source` — who acted. */
  source: 'triage' | 'manual' | 'autopilot' | 'screener';
  /** ISO-8601 — when it happened. */
  occurredAt: string;
  /** Messages moved. 0 for policy-only verbs (Keep, Protect toggles). */
  affectedCount: number;
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
  /**
   * D38 "you wrote to them" tri-state. `true` = only senders the user
   * has written to; `false` = exclude; omit = no constraint. Maps to
   * wire `?wrote-to=true` / `?wrote-to=not`.
   */
  wroteTo?: TriStateFilter | undefined;
  /** D38 — "quiet for N days+" filter. 30 / 90 / 180 / 365 + raw number. */
  windowDays?: number | undefined;
  /** D38 — case-insensitive domain substring (mailbox-wide). */
  domain?: string | undefined;
  /**
   * D51 — "unsub'd, still emailing": senders with a standing
   * `policy_type='unsubscribe'` whose mail kept arriving after the
   * policy was recorded. `true` = require; omit = no constraint. No
   * negated form (not a surface). Maps to wire `?unsub_ignored=true`.
   */
  unsubIgnored?: boolean | undefined;
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
    wroteTo: number;
    protected: number;
    /** D51 — "unsub'd, still emailing" axis count (mailbox-wide). */
    unsubIgnored: number;
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
export function sendersListRequestQuery(
  params: ListSendersParams = {},
): Record<string, string | number | boolean | null | undefined> {
  return {
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
    'wrote-to': params.wroteTo === true ? 'true' : params.wroteTo === false ? 'not' : undefined,
    window: params.windowDays !== undefined ? String(params.windowDays) : undefined,
    domain: params.domain ? params.domain : undefined,
    unsub_ignored: params.unsubIgnored === true ? 'true' : undefined,
  };
}

export function sendersListPath(params: ListSendersParams = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(sendersListRequestQuery(params))) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `/api/senders?${encoded}` : '/api/senders';
}

export function fetchSenders(
  params: ListSendersParams = {},
  signal?: AbortSignal,
): Promise<SenderListEnvelope> {
  return apiGet<SenderListRow[]>('/api/senders', {
    query: sendersListRequestQuery(params),
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

/**
 * `PATCH /api/senders/:id/policy` — request body (D40, D42, D43).
 *
 * Partial SET-STATE patch over the sender's standing policy. Each field
 * is an explicit target state (never a toggle on the wire), so a retried
 * request is naturally idempotent — the BE diffs against the current row
 * and a field already at its target writes nothing (no phantom audit
 * row). Mirrors `senderPolicyPatchSchema` in
 * `apps/api/src/senders/senders.types.ts`.
 */
export interface SenderPolicyPatch {
  /** Only `'keep'` is writable on this route (D40). */
  policyType?: 'keep';
  isProtected?: boolean;
}

/**
 * `PATCH /api/senders/:id/policy` — response (D40, D42, D43). The
 * resulting standing-policy state; field names mirror
 * `SenderListRow.protectionFlags` + `policyType` so callers can
 * reconcile caches without a refetch round-trip. `policyType` is null
 * when the sender still has no policy row.
 */
export interface SenderPolicyResultDto {
  senderId: string;
  policyType: 'keep' | 'archive' | 'unsubscribe' | 'later' | null;
  isProtected: boolean;
  protectionReason: ProtectionReasonWire | null;
  protectionSetAt: string | null;
  /** True when the patch changed at least one field (audit rows written). */
  changed: boolean;
}

/**
 * PATCH /api/senders/:id/policy — standing-policy write (D40, D42, D43).
 *
 * Non-destructive (no Gmail mutation, no undo token) — Keep applies
 * immediately per D40 and the Protect chip is a plain set-state toggle,
 * so this does NOT ride the D226 destructive
 * lifecycle (no preview, no Idempotency-Key header; idempotency is the
 * set-state semantics).
 */
export function patchSenderPolicy(
  id: string,
  patch: SenderPolicyPatch,
  signal?: AbortSignal,
): Promise<Envelope<SenderPolicyResultDto, unknown>> {
  return apiPatch<SenderPolicyResultDto>(
    `/api/senders/${encodeURIComponent(id)}/policy`,
    patch,
    signal ? { signal } : {},
  );
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

/**
 * POST /api/triage/score-sender — ask the engine to take a fresh look.
 *
 * `reason: 'stale'` is the page refreshing a read that had aged past its
 * TTL when it was opened (D25 `stale_refresh`), NOT someone pressing a
 * control. The distinction is recorded so trigger telemetry never
 * claims an intent the user did not have.
 *
 * Sends the sender's row id: the senders wire carries no `sender_key`,
 * and the API resolves the id inside the mailbox scope.
 */
export function requestSenderRescore(
  senderId: string,
  reason: 'user' | 'stale',
  signal?: AbortSignal,
): Promise<Envelope<{ idempotencyKey: string }, unknown>> {
  return apiPost<{ idempotencyKey: string }>(
    '/api/triage/score-sender',
    { senderId, reason },
    { signal },
  );
}
