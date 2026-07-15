/**
 * Brief API — typed fetchers for the Daily Brief endpoints (D61, D63,
 * D67, D69, D70).
 *
 * Wire shape mirrors the BE contract frozen in
 * `apps/api/src/briefs/brief.types.ts` and the controller at
 * `apps/api/src/briefs/brief.controller.ts`. Any drift between BE
 * return types and these declarations is a contract violation the D202
 * envelope was designed to surface at compile time.
 *
 * Same wire-mirror convention as `apps/web/src/lib/api/followups.ts`:
 * the FE defines its expected envelope payload independently of BE so
 * an inadvertent BE-side rename surfaces during typecheck of the
 * consuming hook (`use-brief-today.ts`).
 *
 * Privacy (D7, D228). The BE never returns body, HTML, attachments, or
 * non-allowlisted headers. Only sender metadata, subject, Gmail message
 * ids, and the LLM-composed `narrative` string (synthesized from
 * sender/subject/snippet at generation time, per D7-allowlisted inputs)
 * reach this surface.
 *
 * No client-side state lives here — the fetcher is a pure function the
 * TanStack Query hook in `features/brief/api/` calls from `queryFn`.
 */

import type { Envelope } from '@declutrmail/shared/contracts';

import { apiGet, apiPost } from './client';

/** D62 — provenance of the narrative string. */
export type BriefGeneratedByWire = 'llm_haiku' | 'template';

/**
 * One Reply or FYI row (D63). Sender identity + subject + Gmail message
 * ids for deep-link click-through to Gmail (D41).
 */
export interface BriefItemWire {
  /** sha256("v1|" + normalized_email), hex — matches `senders.sender_key`. */
  senderKey: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  /** Gmail message ids this row collapses; D41 deep-link target. */
  messageIds: string[];
}

/**
 * One Noise sender bucket (D63). The D65 bulk-archive flow uses this
 * shape — that mutation surface is intentionally deferred for the first
 * render PR; here the field is read-only display data.
 */
export interface BriefSenderGroupWire {
  senderKey: string;
  senderName: string;
  /** Yesterday's message count from this sender. */
  messageCount: number;
  /** Yesterday-only Gmail message ids — D65 archive target (deferred). */
  messageIds: string[];
}

/**
 * Full payload shape stored on `brief_runs.brief_payload` — passed
 * through verbatim by the read service. D63 caps the section sizes
 * server-side (Reply ≤ 6, FYI ≤ 4, Noise uncapped); the FE renders
 * whatever the BE delivered without re-clamping.
 */
export interface BriefPayloadWire {
  reply: BriefItemWire[];
  fyi: BriefItemWire[];
  noise: BriefSenderGroupWire[];
  /**
   * D62 narrative — the "sharp executive assistant" voice from Haiku
   * (or the deterministic template fallback). Empty string means the
   * template ran without a pre-amble.
   */
  narrative: string;
}

/** One Brief row as the read service returns it. */
export interface BriefWire {
  id: string;
  /** D69 — local date this Brief covers (YYYY-MM-DD). */
  runDateLocal: string;
  generatedBy: BriefGeneratedByWire;
  briefPayload: BriefPayloadWire;
  /** ISO-8601 — when the 8am snapshot worker fired. */
  generatedAt: string;
  /** ISO-8601 — first in-app view (D61); NULL until the user opens. */
  openedAt: string | null;
  /** ISO-8601 — when the email digest landed; NULL if not opted in. */
  emailSentAt: string | null;
  /** Current user's bounded rating for this frozen Brief. */
  feedbackRating: 'useful' | 'not_useful' | 'wrong_reason' | null;
}

/** Outcome of `POST /briefs/:id/mark-opened` — D61 first-view tracker. */
export interface BriefMarkOpenedResultWire {
  id: string;
  openedAt: string;
}

/**
 * The browser's IANA timezone, or `null` when the runtime can't say
 * (old ICU builds return undefined). Exported for the brief hooks/tests.
 */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * GET /api/briefs/today?tz=<IANA> — the snapshot for today (D69
 * frozen). 404 if the snapshot worker hasn't fired yet (the FE renders
 * an empty / "Brief lands soon" state in that case; the snapshot worker
 * ticks every hour per D69 so a refetch on focus picks it up).
 *
 * `tz` (D64 read-path): the server resolves "today" in the browser's
 * timezone so the Brief day boundary is the user's midnight, not
 * UTC's. Omitted when the runtime can't report a zone — the BE then
 * falls back to the UTC date (the original contract).
 */
export function fetchBriefToday(signal?: AbortSignal): Promise<Envelope<BriefWire, unknown>> {
  const tz = browserTimeZone();
  return apiGet<BriefWire>('/api/briefs/today', {
    signal,
    ...(tz ? { query: { tz } } : {}),
  });
}

/**
 * POST /api/briefs/:id/mark-opened — D61 first-view tracker. Sets
 * `opened_at` once; subsequent calls are idempotent (BE returns the
 * existing timestamp).
 */
export function postBriefMarkOpened(
  id: string,
): Promise<Envelope<BriefMarkOpenedResultWire, unknown>> {
  return apiPost<BriefMarkOpenedResultWire>(`/api/briefs/${id}/mark-opened`);
}
