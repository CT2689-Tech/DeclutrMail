/**
 * Wire-shape projections of the senders fixtures.
 *
 * Fixtures are authored in the ergonomic legacy shape (`SenderFixture`,
 * ./sender-fixture-data). This module is the seam: it takes the fixture
 * objects and emits the EXACT wire shape the BE sends
 * (`SenderListRow`), which `enrichSenderRow` (features/senders/data)
 * consumes — so MSW handlers (or any other test stub) can serve
 * realistic envelopes and mock data flows through the SAME seam as
 * live data.
 *
 * The projection is honest: nullable wire facts come from the fixture
 * or stay absent — nothing is fabricated beyond the documented
 * `totalReceived` derivation for coherent story data.
 *
 * Keep this module pure — no I/O, no Date.now() in body builders so
 * tests can pin time. Each builder accepts a `now` epoch so callers
 * (Vitest tests, Storybook stories) can render deterministically.
 */

import type {
  DecisionHistoryRowDto,
  MailMessageRow,
  SenderDetailDto,
  SenderListRow,
  TimeseriesPointDto,
  UnsubscribeMethod,
} from '../lib/api/senders';
import { buildSenderDetail } from './sender-detail-builder';
import { SENDER_FIXTURES, type SenderFixture } from './sender-fixture-data';

/** Pick a plausible unsubscribe method from the sender's group + protect flag. */
function pickUnsubscribeMethod(s: SenderFixture): UnsubscribeMethod | null {
  // Explicit fixture value wins — `SenderFixture.unsubscribeMethod`
  // mirrors the wire field, so a seed can pin the method instead of
  // riding the group heuristic below.
  if (s.unsubscribeMethod !== undefined) return s.unsubscribeMethod;
  if (s.group === 'primary' || s.protected) return null;
  // Heuristic: promotions usually have one-click List-Unsubscribe-Post;
  // social/forums usually have mailto. Updates default to none unless
  // we override later.
  if (s.group === 'promotions') return 'one_click';
  if (s.group === 'social' || s.group === 'forums') return 'mailto';
  return 'none';
}

/**
 * Project a fixture's standing-policy flags to the wire shape.
 * Shared by the list + detail projections so both agree (the BE now
 * carries `protectionFlags` on the list row too). Auto-protected senders
 * project to `starred` as an explicit automatic-protection fixture.
 * Non-protected senders carry null reason + null timestamp.
 */
function fixtureProtectionFlags(s: SenderFixture, now: number): SenderListRow['protectionFlags'] {
  const isProtected = s.protected === true;
  return {
    isProtected,
    protectionReason: isProtected ? 'starred' : null,
    protectionSetAt: isProtected ? new Date(now).toISOString() : null,
  };
}

/** Project a fixture `SenderFixture` to the wire `SenderListRow`. */
export function fixtureToSenderListRow(s: SenderFixture, now: number = Date.now()): SenderListRow {
  const dayMs = 1000 * 60 * 60 * 24;
  const monthMs = dayMs * 30;
  const lastSeenAt = new Date(now - s.lastDays * dayMs).toISOString();
  const firstSeenAt = new Date(now - s.firstSeenMo * monthMs).toISOString();
  return {
    id: s.id,
    displayName: s.name,
    email: s.email ?? `noreply@${s.domain}`,
    domain: s.domain,
    // `SenderGroup` is an alias of the wire `GmailCategory` — same enum.
    gmailCategory: s.group,
    lastSeenAt,
    firstSeenAt,
    // Fixtures derive totalReceived from `monthly × firstSeenMo` so the
    // synthetic data tells a coherent "this sender has been around N
    // months at M/mo" story (ADR-0014). Stress-case stories can override
    // via `totalReceived` on the seed.
    totalReceived: s.totalReceived ?? Math.max(s.monthly * Math.max(s.firstSeenMo, 1), 0),
    // Engine default is 0 — a fixture can pin an explicit value (e.g.
    // an auto-protected engagement-based row).
    repliedCount: s.repliedCount ?? 0,
    monthlyVolume: s.monthly,
    readRate: s.read,
    // Fixtures don't carry a real trend signal; default to `steady` so
    // Storybook variants render a sensible chip without setting it
    // explicitly. Stress-case stories override via `volumeTrend` on
    // the seed sender.
    volumeTrend: s.volumeTrend ?? 'steady',
    // The fixture's 4-week series rides through as the row sparkline.
    sparkline: s.spark,
    unsubscribeMethod: pickUnsubscribeMethod(s),
    // Fixtures don't carry a real decision history; default to "never
    // reviewed" so the detail header's eyebrow defaults to that copy.
    // Stress-case stories can override with `lastReview` on the seed.
    lastReview: s.lastReview ?? null,
    protectionFlags: fixtureProtectionFlags(s, now),
    // Standing unsub policy — `unsubPending` is the legacy authoring
    // flag for `policy_type = 'unsubscribe'`.
    policyType: s.unsubPending ? 'unsubscribe' : null,
    unsubStatus: s.unsubStatus ?? null,
  };
}

/** Project a fixture to the wire `SenderDetailDto` (list row + protection flags). */
export function fixtureToSenderDetailDto(
  s: SenderFixture,
  now: number = Date.now(),
): SenderDetailDto {
  // `protectionFlags` now rides the list row — the detail shape is the
  // list row (the extends is identical). Kept as a distinct builder so
  // call sites that want "the detail DTO" read intentionally.
  return fixtureToSenderListRow(s, now);
}

/**
 * Project the fixture's per-sender recent-messages list to the wire
 * shape. No `now` param — the underlying builder is already
 * deterministic per `s.id`, so the timestamps are stable across runs.
 */
export function fixtureToMailMessageRows(s: SenderFixture): MailMessageRow[] {
  const detail = buildSenderDetail(s);
  return detail.recentMessages.map((m) => ({
    id: m.id,
    providerMessageId: m.providerMessageId,
    providerThreadId: m.threadId,
    subject: m.subject,
    snippet: m.snippet,
    internalDate: m.receivedAt,
    isUnread: m.unread,
    sizeBytes: m.sizeBytes,
  }));
}

/** Project the fixture's per-sender 12-month series to the wire shape. */
export function fixtureToTimeseries(s: SenderFixture): TimeseriesPointDto[] {
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
export function fixtureToDecisionHistoryRows(s: SenderFixture): DecisionHistoryRowDto[] {
  const detail = buildSenderDetail(s);
  // The wire schema only carries `keep | archive | unsubscribe | later`.
  // Fixture rows include richer actions (Restored, Protected,
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
  return SENDER_FIXTURES.map((s) => fixtureToSenderListRow(s, now));
}
