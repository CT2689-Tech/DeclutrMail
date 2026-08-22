/**
 * D10/D101 — verb-honest copy for the Observe-mode digest.
 *
 * Shared by the RuleCard meta row and the day-7 ObserveWindowBanner so
 * the two surfaces can never disagree on the numbers or the verb.
 * Canonical K/A/U/L/D verbs only (D227): archive / requested unsubscribe /
 * move to Later.
 *
 * WINDOW HONESTY (audit 2026-08-21). This used to read "Would have
 * archived N emails ... in the last 7 days", attaching the 7-day window
 * to BOTH numbers. Only the sender count is windowed: the message count
 * is every INBOX message those senders currently hold, with no date
 * predicate on the join at all — a sender with three years of backlog
 * who matched once yesterday contributed all of it. So the sentence
 * shown to a user deciding whether to hand a rule unattended
 * archive/delete power could overstate by orders of magnitude.
 *
 * The number is the useful one — it is what a sweep right now would act
 * on — so the copy moved to match it rather than the join changing to
 * match the copy. The two counts are now stated as the different things
 * they are.
 */

import type { AutopilotRuleDto } from '@/lib/api/autopilot';

/**
 * One sentence describing what the rule WOULD have done, or null when
 * there is nothing to say (no digest — rule not observing — or no
 * senders matched in the window).
 */
export function observeDigestSummary(rule: AutopilotRuleDto): string | null {
  const digest = rule.observeDigest;
  if (digest == null || digest.senders7d === 0) return null;
  const senders = `${digest.senders7d.toLocaleString('en-US')} sender${digest.senders7d === 1 ? '' : 's'}`;
  const emails = `${digest.inboxMessagesNow.toLocaleString('en-US')} email${digest.inboxMessagesNow === 1 ? '' : 's'}`;
  const matched = `${senders} matched in the last 7 days`;
  switch (rule.actionKind) {
    case 'archive':
      return `Would archive ${emails} now, from ${matched}`;
    case 'later':
      return `Would move ${emails} to Later now, from ${matched}`;
    case 'unsubscribe':
      // Unsubscribe requests act per sender, not per message. A match
      // does not prove the sender will honor the request.
      // Unchanged: this branch only ever counted senders, which IS the
      // windowed number, so it was honest already.
      return `Would have requested unsubscribe from ${senders} in the last 7 days`;
  }
}
