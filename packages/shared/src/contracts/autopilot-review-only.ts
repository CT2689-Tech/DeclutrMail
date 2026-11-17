// Dependency-free on purpose: the web imports this through its own subpath
// (`@declutrmail/shared/contracts/autopilot-review-only`) so marketing pages
// that render a rule card do not pull the zod-backed contracts barrel.

/**
 * Rules that may never act unattended: every batch waits for approval.
 *
 * Delete always does. So does the new-sender matcher: run against the
 * founder's mailbox on 2026-11-17, 382 of the 3,835 senders it would have
 * moved were people the user had written to or Gmail had marked important
 * (founder decision 3A, "Archive only"). The API, both Autopilot workers and
 * the web all read this one predicate.
 */
export function isReviewOnlyRule(rule: { presetKey: string | null; actionKind: string }): boolean {
  return rule.actionKind === 'delete' || rule.presetKey === 'auto_screen_new_senders';
}
