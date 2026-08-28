/**
 * The product's ONE definition of "the last 90 days".
 *
 * It was written out independently in four places — the scorer, the activity
 * read service, the triage read service and the action preview's SQL — with
 * nothing holding them equal. That is not a tidiness problem. The scorer
 * writes "1% read rate over the last 90 days" into a triage row's own
 * reasoning text, and the triage read service renders the stat tile directly
 * above that sentence; when one of those was changed in isolation the two
 * described different spans on the same card, and every check passed. A
 * constant makes that change fail loudly instead of silently disagreeing.
 *
 * ROLLING, not anchored to a calendar day. "The last 90 days" is a trailing
 * window, and anchoring it to UTC midnight makes it 90-to-91 days wide and
 * wrong for readers either side of the anchor.
 */
export const ENGAGEMENT_WINDOW_DAYS = 90;

/** `ENGAGEMENT_WINDOW_DAYS` in milliseconds. */
export const ENGAGEMENT_WINDOW_MS = ENGAGEMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Start of the trailing engagement window.
 *
 * Callers that compare a numerator against a denominator MUST derive both
 * from ONE call, not two — two calls are two instants, and the ratio then
 * spans two different windows.
 */
export function engagementWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - ENGAGEMENT_WINDOW_MS);
}
