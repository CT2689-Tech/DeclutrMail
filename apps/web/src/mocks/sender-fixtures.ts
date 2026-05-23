/**
 * Wire-shape projections of the existing senders fixtures.
 *
 * The product UI was prototyped against rich in-memory fixtures (see
 * `features/senders/data.ts`). The frozen BE contract uses different
 * field names + a narrower schema. This module is the seam: it takes
 * the fixture objects and emits the EXACT wire shape the BE will send,
 * so MSW handlers (or any other test stub) can serve realistic
 * envelopes without re-typing every endpoint.
 *
 * Anything that lives ONLY in the fixtures (sparkline, spike multiplier,
 * lifetime totals) is dropped — those fields aren't on the wire today,
 * and the FE adapter (`features/senders/api/adapters.ts`) synthesises
 * sensible fallbacks where they're needed.
 *
 * Keep this module pure — no I/O, no Date.now() in body builders so
 * tests can pin time. Each builder accepts a `now` epoch so callers
 * (Vitest tests, Storybook stories) can render deterministically.
 */

import { SENDERS, type Sender, type SenderGroup } from '../features/senders/data';
import { buildSenderDetail } from '../features/senders/detail/data';
import type {
  DecisionHistoryRowDto,
  GmailCategory,
  MailMessageRow,
  SenderDetailDto,
  SenderListRow,
  TimeseriesPointDto,
  UnsubscribeMethod,
} from '../lib/api/senders';

const GROUP_TO_CATEGORY: Record<SenderGroup, GmailCategory> = {
  primary: 'primary',
  promotions: 'promotions',
  social: 'social',
  updates: 'updates',
  forums: 'forums',
};

/** Pick a plausible unsubscribe method from the sender's group + protect flag. */
function pickUnsubscribeMethod(s: Sender): UnsubscribeMethod | null {
  if (s.group === 'primary' || s.protected) return null;
  // Heuristic: promotions usually have one-click List-Unsubscribe-Post;
  // social/forums usually have mailto. Updates default to none unless
  // we override later.
  if (s.group === 'promotions') return 'one_click';
  if (s.group === 'social' || s.group === 'forums') return 'mailto';
  return 'none';
}

/** Project a fixture `Sender` to the wire `SenderListRow`. */
export function fixtureToSenderListRow(s: Sender, now: number = Date.now()): SenderListRow {
  const dayMs = 1000 * 60 * 60 * 24;
  const monthMs = dayMs * 30;
  const lastSeenAt = new Date(now - s.lastDays * dayMs).toISOString();
  const firstSeenAt = new Date(now - s.firstSeenMo * monthMs).toISOString();
  return {
    id: s.id,
    displayName: s.name,
    email: `noreply@${s.domain}`,
    domain: s.domain,
    gmailCategory: GROUP_TO_CATEGORY[s.group],
    lastSeenAt,
    firstSeenAt,
    monthlyVolume: s.monthly,
    readRate: s.read,
    unsubscribeMethod: pickUnsubscribeMethod(s),
  };
}

/** Project a fixture `Sender` to the wire `SenderDetailDto` (list row + protection flags). */
export function fixtureToSenderDetailDto(s: Sender, now: number = Date.now()): SenderDetailDto {
  return {
    ...fixtureToSenderListRow(s, now),
    protectionFlags: {
      vip: false,
      protect: s.protected === true,
    },
  };
}

/**
 * Project the fixture's per-sender recent-messages list to the wire
 * shape. No `now` param — the underlying builder is already
 * deterministic per `s.id`, so the timestamps are stable across runs.
 */
export function fixtureToMailMessageRows(s: Sender): MailMessageRow[] {
  const detail = buildSenderDetail(s);
  return detail.recentMessages.map((m) => ({
    id: m.id,
    providerMessageId: m.providerMessageId,
    providerThreadId: m.threadId,
    subject: m.subject,
    snippet: m.snippet,
    internalDate: m.receivedAt,
    isUnread: m.unread,
  }));
}

/** Project the fixture's per-sender 12-month series to the wire shape. */
export function fixtureToTimeseries(s: Sender): TimeseriesPointDto[] {
  const detail = buildSenderDetail(s);
  return detail.timeseries.map((p) => ({
    // Wire uses YYYY-MM-DD; fixture stores YYYY-MM. Pin to the first of
    // the month so the contract stays exact.
    yearMonth: `${p.yearMonth}-01`,
    volume: p.volume,
    readCount: p.opens,
  }));
}

/** Project the fixture's per-sender history to the wire shape (narrowed). */
export function fixtureToDecisionHistoryRows(s: Sender): DecisionHistoryRowDto[] {
  const detail = buildSenderDetail(s);
  // The wire schema only carries `keep | archive | unsubscribe | later`.
  // Fixture rows include richer actions (VIP toggles, Restored, Protected,
  // etc.) — those don't map to a verdict so we drop them. The remaining
  // rows project cleanly.
  const verdictMap: Record<string, DecisionHistoryRowDto['verdict']> = {
    Kept: 'keep',
    Archived: 'archive',
    Unsubscribed: 'unsubscribe',
    'Moved to Later': 'later',
  };
  return detail.history.flatMap((row) => {
    const verdict = verdictMap[row.action];
    if (!verdict) return [];
    return [
      {
        id: row.id,
        verdict,
        confidence: 0.8,
        producedAt: row.at,
        reasoning: 'Projected from fixture for FE wire-up tests.',
        generatedBy: 'template' as const,
      },
    ];
  });
}

/** Convenience: project the full fixture dataset to wire list rows. */
export function allFixtureListRows(now: number = Date.now()): SenderListRow[] {
  return SENDERS.map((s) => fixtureToSenderListRow(s, now));
}
