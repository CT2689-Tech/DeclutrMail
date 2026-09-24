import { normalizeProtectionReason, protectionReasonLabel } from '@declutrmail/shared/copy';

import type { TriageDecisionRow } from './data';

/**
 * The EXACT reason a sender is Protected (CLAUDE.md §2.6 / D245), in
 * the user's own terms. One shared source across Screener, Triage,
 * Sender Detail and the Settings policies list — this used to be four
 * hand-written copies that had already drifted.
 */
function protectionEvidence(row: TriageDecisionRow): string {
  // A shield whose evidence no longer holds must not keep asserting it
  // — the D245 review names those rows in its own header, so repeating
  // the old reason here makes the screen contradict itself. Only an
  // explicit `false` does this: `null`/`undefined` mean unmeasurable,
  // which is not a contradiction.
  if (row.protectionEvidenceCurrent === false) {
    return 'Protected · we can no longer confirm you wrote to them';
  }
  return protectionReasonLabel(normalizeProtectionReason(row.protectionReason));
}

/**
 * What the protection is holding back. On the D245 review this is the
 * ranking key, so it has to be visible at rest — otherwise the order
 * looks arbitrary. Omitted at zero rather than printed as "shielding 0
 * unread": there is nothing in the inbox to shield, and a measurement
 * of nothing reads as a measurement. Narrowed through a local so the
 * clause is structurally unreachable when the wire omitted the measure
 * — absent is unknown, not zero.
 */
function protectedWhy(row: TriageDecisionRow): string {
  const evidence = protectionEvidence(row);
  const shielded = row.unreadInboxCount;
  return shielded != null && shielded > 0
    ? `${evidence} · shielding ${shielded.toLocaleString('en-US')} unread`
    : evidence;
}

/**
 * The 90-day read phrase. Two separate honesty constraints.
 *
 * WINDOW: every phrase names 90 days, because `readRate` IS a 90-day
 * ratio (`triage.read-service.ts` — `last90Read / last90Total`). This
 * said "Never opened", an absolute lifetime claim built from 90 days,
 * on the product's core ritual.
 *
 * VERB: "marked read", never "opened" or a bare "read". Gmail exposes
 * only the absence of the UNREAD label and no open event at all, so we
 * cannot tell a human reading a message from a Gmail filter, a bulk
 * mark-as-read, or a third-party sweeper stripping UNREAD over the API
 * (D45). "% read" claims the human; "% marked read" claims the label.
 */
function readPhrase(readRate: number, last90dMessages: number): string {
  if (readRate === 0 && last90dMessages >= 8) return 'None marked read in 90d';
  return `${Math.round(readRate * 100)}% marked read in 90d`;
}

/**
 * Tight one-line "why" for the list row at rest (D36 — critical info
 * default). Uses `last90dMessages` instead of the derived
 * `monthlyVolume = round(last90 / 3)` so a sender that mailed twice in
 * the last 90d reads as "2 in last 90d", not "0/mo" — the lie pattern
 * founder caught 2026-06-06 (same class as Sender Detail Bug 3).
 */
export function whyLine(row: TriageDecisionRow): string {
  if (row.protectionReason !== null) return protectedWhy(row);
  if (row.last90dMessages === 0) {
    // Quiet within the rolling window — say so plainly. Received total
    // carries the "they DID mail you" context without faking cadence.
    return `Quiet 90d · ${row.totalAllTime.toLocaleString('en-US')} received`;
  }
  if (row.readRate === null) {
    // No denominator, so no rate. Reachable independently of the quiet
    // branch above (the BE derives them from different windows), and a
    // fabricated "0% read" here would read as "never opened".
    return `${row.last90dMessages} in last 90d`;
  }
  const phrase = readPhrase(row.readRate, row.last90dMessages);
  if (row.readRate >= 0.7) return `${phrase} · keep close`;
  return `${phrase} · ${row.last90dMessages} ${row.last90dMessages === 1 ? 'message' : 'messages'}`;
}

/**
 * The same facts split for the focus card, which prints the count as
 * its one big number — so the why-line there must not repeat it.
 */
export function focusFacts(row: TriageDecisionRow): {
  count: number;
  unit: string;
  why: string | null;
} {
  const windowed = {
    count: row.last90dMessages,
    unit: `${row.last90dMessages === 1 ? 'email' : 'emails'} in 90 days`,
  };
  if (row.protectionReason !== null) return { ...windowed, why: protectedWhy(row) };
  if (row.last90dMessages === 0) {
    return {
      count: row.totalAllTime,
      unit: `${row.totalAllTime === 1 ? 'email' : 'emails'} received`,
      why: 'Quiet 90d',
    };
  }
  if (row.readRate === null) return { ...windowed, why: null };
  const phrase = readPhrase(row.readRate, row.last90dMessages);
  return { ...windowed, why: row.readRate >= 0.7 ? `${phrase} · keep close` : phrase };
}
