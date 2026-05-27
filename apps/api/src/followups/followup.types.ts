import type { FollowupStatus } from '@declutrmail/db';

/**
 * D85 — priority bucket computed at API request time from `sent_at`.
 *
 *   high   — sent more than 7 days ago
 *   medium — sent 3–7 days ago
 *   low    — sent 1–3 days ago
 *   fresh  — sent less than 1 day ago (in UI we hide these or
 *            group them with low; the read service returns them so
 *            the FE can decide)
 *
 * "Replied" / "Dismissed" rows are NOT returned by the awaiting list
 * endpoint at launch, so they don't need a priority value. The
 * read service surfaces the union as a string field for forward
 * compatibility.
 */
export type FollowupPriority = 'high' | 'medium' | 'low' | 'fresh';

/** One followup row as the read service returns it. */
export interface Followup {
  id: string;
  providerThreadId: string;
  recipientEmail: string;
  recipientDisplayName: string;
  subject: string;
  /** ISO-8601 — when the user's outbound message went out. */
  sentAt: string;
  /** D85 — computed at request time, NOT stored. */
  priority: FollowupPriority;
  status: FollowupStatus;
  /** ISO-8601 — when the user dismissed (D88). NULL for active rows. */
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Outcome of `POST /followups/:id/dismiss` (D88). */
export interface FollowupDismissResult {
  id: string;
  status: FollowupStatus;
  dismissedAt: string;
  /**
   * Phase-1 idempotency hint (D202/D207): `true` when the row was
   * already in the `dismissed` terminal state — request was a no-op
   * replay rather than the first dismiss. Lets a client retrying a
   * flaky network request render the success state without having to
   * disambiguate from a 404 "followup not found". Phase-2 lands the
   * full `Idempotency-Key` table; until then this hint is the contract.
   */
  alreadyDismissed: boolean;
}
