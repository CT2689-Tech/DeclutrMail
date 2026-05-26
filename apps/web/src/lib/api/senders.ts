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
 */
export type VolumeTrendBucket = 'new' | 'up' | 'down' | 'steady' | 'dormant';

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
  unsubscribeMethod: UnsubscribeMethod | null;
  /** Most-recent triage decision summary. `null` when never reviewed. */
  lastReview: LastReviewWire | null;
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
  /** How the decision was produced — LLM vs deterministic template. */
  generatedBy: 'llm' | 'template';
}

// ── Fetchers ────────────────────────────────────────────────────────

export interface ListSendersParams {
  category?: GmailCategory | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/** GET /api/senders — paginated sender list (D39). */
export function fetchSenders(
  params: ListSendersParams = {},
  signal?: AbortSignal,
): Promise<PaginatedEnvelope<SenderListRow>> {
  return apiGet<SenderListRow[]>('/api/senders', {
    query: {
      category: params.category,
      limit: params.limit,
      cursor: params.cursor,
    },
    signal,
  }) as Promise<PaginatedEnvelope<SenderListRow>>;
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
