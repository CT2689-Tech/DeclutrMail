'use client';

import type { ReactNode } from 'react';
import { Button, EmptyState, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { TriageSessionStats } from './data';

const { color, font, radius, text } = tokens;
const FREE_CLEANUP_LIMIT = TIER_MANIFEST.free.cleanupActionsPerMonth;

/**
 * The triage empty state (D33 + D212).
 *
 * Two shapes, split on `stats.decidedToday`:
 *
 *   - `decidedToday === 0` — the D212 RESTING state ("Nothing needs a
 *     decision."): the queue is empty but the user cleared nothing
 *     today, so the celebration below would be a false claim over
 *     four zero tiles. Renders the shared `<EmptyState>` primitive.
 *   - `decidedToday > 0` — the D33 ritual-completion state below.
 *
 * The D33 state is five pieces, in this order:
 *
 *   1. Stats summary — what the user got done today (decided / archived
 *      / unsubscribed / later). The number
 *      gives the empty state weight — it isn't "nothing to do, the
 *      app is empty"; it's "you cleared the queue today".
 *
 *   2. Calm re-entry copy — another decision appears only when a sync
 *      finds a repeated sender pattern; there is no daily obligation.
 *
 *   3. A subtle upgrade nudge — tier-gated per D17–D21:
 *        free → "See Plus" (lifts the A3 50/month cleanup cap)
 *        plus → "Pro could do this for you automatically" (D33 quote)
 *        pro  → no nudge; D33 explicitly hides it for Pro users.
 *      `freeRemaining` is the MONTHLY remainder (config-driven via
 *      the BE; replaced the old 25/day display counter), so the nudge
 *      is always relevant on free once any cleanup action is spent.
 *
 * Privacy note (D7): no body content, no message subjects — only the
 * decision counts and the upgrade pitch. The same constraint applies
 * across every triage surface.
 */
export function TriageEmptyState({
  stats,
  onOpenUpgrade,
  syncFailed = false,
  footnote,
}: {
  stats: TriageSessionStats;
  onOpenUpgrade?: () => void;
  /**
   * QA-sync-20260831-01: the active mailbox's INITIAL sync has
   * terminally failed (`readiness_status === 'failed'`) — not merely
   * `queued`/`syncing`. Triage otherwise has zero sync awareness at all,
   * so a resting-queue read during a broken sync renders the same
   * confident "nothing to do" claim as a genuinely caught-up mailbox.
   */
  syncFailed?: boolean;
  /** One muted line under the completion numerals (the D214 "today" fact). */
  footnote?: ReactNode;
}) {
  // D212 resting state (2026-07-02 audit W5) — the queue is empty and
  // the user decided NOTHING today: a fresh morning visit, or a new
  // mailbox before the engine scores anything. The completion panel
  // below would be false over a grid of four zeros, so the inbox-zero
  // moment renders the shared
  // D212 EmptyState instead: calm, mental-model copy, one next step.
  // The single editorial phrase is the ADR-0011 allowance for
  // first-class empty states.
  if (stats.decidedToday === 0 && syncFailed) {
    // "Nothing needs a decision" is a claim about the queue having been
    // checked; a failed scan means it hasn't been. The button goes where
    // the copy points — Settings → Gmail accounts.
    return (
      <EmptyState
        title="This mailbox's last scan didn't finish."
        description="Your Gmail is untouched. Retry the scan in Settings → Gmail accounts."
        action={
          <a href="/settings#mailboxes" style={LINK_BUTTON}>
            Open Settings
          </a>
        }
      />
    );
  }
  if (stats.decidedToday === 0) {
    return (
      <EmptyState
        title="Nothing needs a decision right now."
        description="New decisions appear as senders send again."
        action={
          <a href="/senders" style={LINK_BUTTON}>
            Browse senders
          </a>
        }
      />
    );
  }

  const showPlusNudge =
    stats.tier === 'free' && stats.freeRemaining != null && stats.freeRemaining <= 5;
  const showProNudge = stats.tier === 'plus';
  // What you actually did today, as one quiet line. D9 — "unsubscribes"
  // counts DECISIONS, which execute async (one-click may fail, mailto is
  // manual); "unsubscribed" would overclaim (mirrors the Activity tile).
  const tally: Array<[number, string]> = [
    [stats.decidedToday, 'decided'],
    [stats.archivedToday, 'archived'],
    [stats.unsubscribedToday, stats.unsubscribedToday === 1 ? 'unsubscribe' : 'unsubscribes'],
    [stats.laterToday, 'to Later'],
  ];
  return (
    <div
      style={{
        padding: '56px 16px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        textAlign: 'center',
        fontFamily: font.sans,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          background: color.primarySoft,
          color: color.primary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>

      <div>
        <h2
          style={{
            fontSize: text['2xl'],
            fontWeight: 650,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          You&rsquo;re done for now.
        </h2>
        <p style={{ fontSize: text.md, color: color.fgSoft, margin: '8px 0 0', lineHeight: 1.55 }}>
          New decisions appear as senders send again.
        </p>
      </div>

      <p
        data-dm-triage-tally
        style={{
          margin: 0,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '4px 16px',
          fontSize: text.sm,
          color: color.fgMuted,
        }}
      >
        {/* Zero entries drop out — except the lead, which is why this
            screen renders at all. */}
        {tally
          .filter(([value], i) => i === 0 || value > 0)
          .map(([value, label]) => (
            <span key={label}>
              <span
                style={{
                  fontWeight: 600,
                  color: color.fg,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {value.toLocaleString('en-US')}
              </span>{' '}
              {label}
            </span>
          ))}
      </p>
      {footnote}

      {/* D33 Free-tier nudge — surfaces when the D19 monthly cleanup cap
          is in view (≤5 cleanup actions left). */}
      {showPlusNudge && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: text.sm, color: color.fgSoft }}>
            {stats.freeRemaining === 0
              ? `You've used all ${FREE_CLEANUP_LIMIT} free cleanup actions this month.`
              : `${stats.freeRemaining} of your ${FREE_CLEANUP_LIMIT} free cleanup actions left this month.`}
          </span>
          <Button tone="primary" size="md" onClick={onOpenUpgrade ?? (() => {})}>
            See Plus
          </Button>
        </div>
      )}

      {/* D33 Plus-tier nudge — single soft link, not a banner. Hidden
          for Pro users (no nudge shown). */}
      {showProNudge && (
        <button
          type="button"
          onClick={onOpenUpgrade ?? (() => {})}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: font.sans,
            fontSize: text.sm,
            color: color.fgSoft,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          See Pro automation
        </button>
      )}
    </div>
  );
}

const LINK_BUTTON = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 36,
  padding: '0 16px',
  background: color.fill,
  color: color.fg,
  borderRadius: radius.pill,
  fontFamily: font.sans,
  fontSize: text.base,
  fontWeight: 600,
  textDecoration: 'none',
} as const;
