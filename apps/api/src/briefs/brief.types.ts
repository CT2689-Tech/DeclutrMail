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

/**
 * D65 — live archive-target resolution for one Noise sender.
 *
 * Deliberately NOT folded into `BriefPayload.noise`: that payload is the
 * frozen 8am snapshot (D69) and must keep saying exactly what it said at
 * 8am. Protection is today's D245 state and can flip after the snapshot
 * was taken, so it is resolved on every read and returned alongside.
 */
export interface BriefNoiseSender {
  /** Joins to `BriefSenderGroup.senderKey` in the frozen payload. */
  senderKey: string;
  /**
   * `senders.id` — the address the archive selector takes. NULL when the
   * sender row no longer exists for this mailbox, which makes the row
   * unactionable rather than silently mis-targeted.
   */
  senderId: string | null;
  /** D245 — Protected senders are excluded from bulk mail-changing actions. */
  isProtected: boolean;
}

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
  /** D246 — the current user's closed-vocabulary rating, if submitted. */
  feedbackRating: 'useful' | 'not_useful' | 'wrong_reason' | null;
  /**
   * D65 — one entry per `briefPayload.noise` group, resolved at read
   * time. Empty when the Brief has no Noise section.
   */
  noiseSenders: BriefNoiseSender[];
}

/** Outcome of `POST /briefs/:id/mark-opened` — D61 first-view tracker. */
export interface BriefMarkOpenedResult {
  id: string;
  /** ISO-8601 — the timestamp now persisted on `brief_runs.opened_at`. */
  openedAt: string;
}
