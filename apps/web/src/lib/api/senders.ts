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
  /** Recent monthly cadence (4-week trailing average). */
  monthlyVolume: number;
  /** Open rate over the trailing window — 0..1. */
  readRate: number;
  unsubscribeMethod: UnsubscribeMethod | null;
}

/**
 * Detail shape on `GET /api/senders/:id` — extends the list row with
 * the protection-flag block. VIP and Protect are separate user-driven
 * policies (D42 / D43); both are mutually independent of each other.
 */
export interface SenderDetailDto extends SenderListRow {
  protectionFlags: {
    vip: boolean;
    protect: boolean;
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
