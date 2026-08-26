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
 * One Noise sender bucket (D63), exactly as the 8am snapshot froze it.
 * Every field here is a statement about YESTERDAY and never changes
 * during the day (D69) — the live archive target for the same sender
 * arrives separately on `BriefWire.noiseSenders`.
 */
export interface BriefSenderGroupWire {
  senderKey: string;
  senderName: string;
  /** Yesterday's message count from this sender. */
  messageCount: number;
  /** Yesterday-only Gmail message ids — D41 deep-link target. */
  messageIds: string[];
}

/**
 * D65 — live archive-target resolution for one Noise sender, joined to
 * `BriefSenderGroupWire` on `senderKey`.
 *
 * Kept out of the frozen payload on purpose: `isProtected` is today's
 * D245 state, not the state at 8am, and folding it into a snapshot the
 * product promises is frozen would make the payload lie.
 */
export interface BriefNoiseSenderWire {
  senderKey: string;
  /** `senders.id` — what the archive selector addresses. Null = unactionable. */
  senderId: string | null;
  /** D245 — Protected senders are excluded from bulk mail-changing actions. */
  isProtected: boolean;
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
  /**
   * How many Reply candidates existed BEFORE the D63 cap, and likewise
   * for FYI. Without these the screen could only render "6 of 6" — the
   * cap describing itself as if it were a fact about the day — and the
   * narrative could never know a seventh urgent item had been dropped,
   * because the worker discards it before either sees the payload.
   *
   * Optional: Briefs are frozen once written (D69), so rows generated
   * before this field existed keep their shape. A missing value means
   * "no truncation information", and the consumer falls back to showing
   * the plain count rather than inventing one.
   */
  replyTotal?: number;
  fyiTotal?: number;
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
  /**
   * D65 — one entry per `briefPayload.noise` group. Empty when there is
   * no Noise section, and also empty against an API deployed before this
   * field existed (apps/web and apps/api ship independently), in which
   * case the Noise rows render read-only rather than offering an archive
   * whose target the client cannot address.
   */
  noiseSenders: BriefNoiseSenderWire[];
}

/** Outcome of `POST /briefs/:id/mark-opened` — D61 first-view tracker. */
export interface BriefMarkOpenedResultWire {
  id: string;
  openedAt: string;
}

/**
 * GET /api/briefs/today — the snapshot for today (D69 frozen). 404 if
 * the snapshot worker hasn't fired yet (the FE renders
 * an empty / "Brief lands soon" state in that case; the snapshot worker
 * ticks every hour per D69 so a refetch on focus picks it up).
 *
 * The server resolves the day from persisted `users.timezone`, the
 * same authority snapshot generation uses. Browser state cannot select
 * a different Brief day.
 */
export async function fetchBriefToday(signal?: AbortSignal): Promise<Envelope<BriefWire, unknown>> {
  const envelope = await apiGet<BriefWire>('/api/briefs/today', { signal });
  return { ...envelope, data: { ...envelope.data, noiseSenders: toNoiseSenders(envelope.data) } };
}

/**
 * `GET /api/briefs?from=&to=` — D61 history. Returns the frozen
 * snapshots in the range, newest first, each with its full payload, so
 * the screen can move between days without another round trip.
 *
 * Runs `toNoiseSenders` per row for the same reason `fetchBriefToday`
 * does: an absent field must land as "nothing is actionable", never as
 * `undefined` the archive controls then index into.
 */
export async function fetchBriefHistory(
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<Envelope<BriefWire[], unknown>> {
  const query = new URLSearchParams({ from, to }).toString();
  const envelope = await apiGet<BriefWire[]>(`/api/briefs?${query}`, { signal });
  const rows = Array.isArray(envelope.data) ? envelope.data : [];
  return { ...envelope, data: rows.map((row) => ({ ...row, noiseSenders: toNoiseSenders(row) })) };
}

/**
 * Absorb `noiseSenders` at the one boundary it enters through. An API
 * built before D65 omits the field entirely; the archive controls read
 * this array to decide what is actionable, so an absent field must land
 * as "nothing is actionable", never as `undefined` the UI then indexes.
 */
function toNoiseSenders(data: BriefWire): BriefNoiseSenderWire[] {
  const raw: unknown = (data as { noiseSenders?: unknown }).noiseSenders;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): BriefNoiseSenderWire[] => {
    if (row === null || typeof row !== 'object') return [];
    const { senderKey, senderId, isProtected } = row as Record<string, unknown>;
    if (typeof senderKey !== 'string') return [];
    return [
      {
        senderKey,
        senderId: typeof senderId === 'string' ? senderId : null,
        // Fail SAFE on a malformed flag: an unreadable protection state
        // must not read as "not protected" and let a Protected sender
        // into a bulk action (D245).
        isProtected: isProtected !== false,
      },
    ];
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
