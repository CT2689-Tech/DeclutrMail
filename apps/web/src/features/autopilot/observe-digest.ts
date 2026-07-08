/**
 * D10/D101 — verb-honest copy for the Observe-mode digest ("would have
 * archived N emails from M senders in the last 7 days").
 *
 * Shared by the RuleCard meta row and the day-7 ObserveWindowBanner so
 * the two surfaces can never disagree on the numbers or the verb.
 * Canonical K/A/U/L/D verbs only (D227): archived / unsubscribed /
 * moved to Later.
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
  const senders = `${digest.senders7d.toLocaleString()} sender${digest.senders7d === 1 ? '' : 's'}`;
  const emails = `${digest.messages7d.toLocaleString()} email${digest.messages7d === 1 ? '' : 's'}`;
  switch (rule.actionKind) {
    case 'archive':
      return `Would have archived ${emails} from ${senders} in the last 7 days`;
    case 'later':
      return `Would have moved ${emails} from ${senders} to Later in the last 7 days`;
    case 'unsubscribe':
      // Unsubscribe acts per sender (an intent), not per message — the
      // sender count is the honest number here.
      return `Would have unsubscribed from ${senders} in the last 7 days`;
  }
}
