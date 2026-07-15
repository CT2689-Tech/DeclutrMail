import type { BriefGeneratedBy } from '@declutrmail/db';

export interface BriefItem {
  senderKey: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  messageIds: string[];
}

export interface BriefSenderGroup {
  senderKey: string;
  senderName: string;
  messageCount: number;
  messageIds: string[];
}

export interface BriefPayload {
  reply: BriefItem[];
  fyi: BriefItem[];
  noise: BriefSenderGroup[];
  narrative: string;
}

/**
 * Wire types for the Brief HTTP surface (D61, D62, D69).
 *
 * Mirrors `brief_runs` rows in their external-facing form: ISO strings
 * instead of Date, the `BriefPayload` jsonb passed through verbatim
 * (typed at the DB layer; the FE consumes the same shape).
 *
 * The `BriefReadService` is the only place that translates between
 * DB rows and these types.
 */

/** One Brief row as the read service returns it. */
export interface Brief {
  id: string;
  /** D69 — the user's local date this Brief covers (YYYY-MM-DD). */
  runDateLocal: string;
  /** D62 — provenance of the narrative + sections. */
  generatedBy: BriefGeneratedBy;
  /** The full D63 3-section snapshot + narrative. */
  briefPayload: BriefPayload;
  /** When the 8am snapshot fired (ISO-8601). */
  generatedAt: string;
  /** First in-app view (ISO-8601); NULL until the user opens the Brief. */
  openedAt: string | null;
  /** D61 optional email channel (ISO-8601); NULL when not opted in. */
  emailSentAt: string | null;
}

/** Outcome of `POST /briefs/:id/mark-opened` — D61 first-view tracker. */
export interface BriefMarkOpenedResult {
  id: string;
  /** ISO-8601 — the timestamp now persisted on `brief_runs.opened_at`. */
  openedAt: string;
}
