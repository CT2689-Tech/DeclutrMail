'use client';

import { Button, EmptyState, tokens } from '@declutrmail/shared';
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import type { TriageSessionStats } from './data';

const { color, font } = tokens;
const FREE_CLEANUP_LIMIT = TIER_MANIFEST.free.cleanupActionsLifetime;

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
 *      / unsubscribed / later) plus the streak day count. The number
 *      gives the empty state weight — it isn't "nothing to do, the
 *      app is empty"; it's "you cleared the queue today".
 *
 *   2. "Come back tomorrow" — the engine refills the queue overnight
 *      from the next sync sweep + the weekly re-score cron (D25).
 *
 *   3. A subtle upgrade nudge — tier-gated per D17–D21:
 *        free → "See Plus" (lifts the D19 5-LIFETIME cleanup cap)
 *        plus → "Pro could do this for you automatically" (D33 quote)
 *        pro  → no nudge; D33 explicitly hides it for Pro users.
 *      `freeRemaining` is the LIFETIME remainder (manifest-driven via
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
}: {
  stats: TriageSessionStats;
  onOpenUpgrade?: () => void;
}) {
  // D212 resting state (2026-07-02 audit W5) — the queue is empty and
  // the user decided NOTHING today: a fresh morning visit, or a new
  // mailbox before the engine scores anything. The D33 celebration
  // below would be false here ("You cleared today's queue." over a
  // grid of four zeros), so the inbox-zero moment renders the shared
  // D212 EmptyState instead: calm, mental-model copy, one next step.
  // The single editorial phrase is the ADR-0011 allowance for
  // first-class empty states.
  if (stats.decidedToday === 0) {
    return (
      <EmptyState
        title="No decisions today."
        description="A decision appears here when a sender starts creating repeated noise."
        action={
          <a
            href="/senders"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 32,
              padding: '0 14px',
              background: color.card,
              color: color.fg,
              border: `1px solid ${color.line}`,
              borderRadius: 7,
              fontFamily: font.sans,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Browse senders
          </a>
        }
      />
    );
  }

  const showPlusNudge =
    stats.tier === 'free' && stats.freeRemaining != null && stats.freeRemaining <= 5;
  const showProNudge = stats.tier === 'plus';
  return (
    <div
      style={{
        padding: '32px 24px 40px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 14,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 18,
        textAlign: 'center',
        fontFamily: font.sans,
      }}
    >
      {/* Halo icon — checkmark in a teal disc. */}
      <span
        aria-hidden="true"
        style={{
          width: 56,
          height: 56,
          borderRadius: 9999,
          background: color.primarySoft,
          color: color.primary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="22"
          height="22"
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
            fontFamily: font.display,
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: '-0.014em',
            margin: 0,
          }}
        >
          You cleared today&rsquo;s queue.
        </h2>
        <p
          style={{
            fontSize: 13.5,
            color: color.fgSoft,
            margin: '8px 0 0',
            lineHeight: 1.55,
            maxWidth: 460,
          }}
        >
          New decisions appear after a sync finds another repeated sender pattern.
        </p>
      </div>

      {/* Stats summary — what you actually did today. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 10,
          width: '100%',
          maxWidth: 520,
        }}
      >
        <StatTile label="Decided" value={stats.decidedToday} />
        <StatTile label="Archived" value={stats.archivedToday} />
        {/* D9 — counts unsubscribe DECISIONS this session, which execute
            async (one-click may fail, mailto is manual). "Unsubscribes"
            counts the actions taken without claiming verified success;
            "Unsubscribed" would overclaim (mirrors the Activity tile). */}
        <StatTile label="Unsubscribes" value={stats.unsubscribedToday} />
        <StatTile label="To Later" value={stats.laterToday} />
      </div>

      {stats.streakDays > 0 && (
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: color.fgMuted,
          }}
        >
          Decisions made on {stats.streakDays} consecutive day
          {stats.streakDays === 1 ? '' : 's'}
        </span>
      )}

      {/* D33 Free-tier nudge — "See Plus" surfaces when the D19
          lifetime cleanup cap is in view (≤5 cleanup actions left). */}
      {showPlusNudge && (
        <div
          style={{
            marginTop: 6,
            padding: '14px 16px',
            background: color.primaryWash,
            border: `1px solid ${color.primaryBorder}`,
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            justifyContent: 'center',
            maxWidth: 520,
          }}
        >
          <span style={{ fontSize: 12.5, color: color.fg, textAlign: 'left' }}>
            <strong style={{ fontWeight: 600 }}>
              {stats.freeRemaining === 0
                ? `You've used all ${FREE_CLEANUP_LIMIT} free cleanup actions.`
                : `${stats.freeRemaining} of your ${FREE_CLEANUP_LIMIT} free cleanup actions left.`}
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              Plus removes the cap — unlimited archive, delete, and unsubscribe.
            </span>
          </span>
          <Button tone="primary" size="sm" onClick={onOpenUpgrade ?? (() => {})}>
            See Plus
          </Button>
        </div>
      )}

      {/* D33 Plus-tier nudge — single soft link, not a banner. The
          copy is the D33 quote verbatim. Hidden for Pro users (no
          nudge shown). */}
      {showProNudge && (
        <button
          type="button"
          onClick={onOpenUpgrade ?? (() => {})}
          style={{
            marginTop: 4,
            background: 'transparent',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontFamily: font.sans,
            fontSize: 12.5,
            color: color.fgSoft,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            textDecorationColor: color.lineSoft,
          }}
        >
          Pro could do this for you automatically. Learn more &rarr;
        </button>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        background: color.paper,
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontFamily: font.display,
          fontWeight: 600,
          fontSize: 22,
          letterSpacing: '-0.018em',
          color: color.fg,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toLocaleString()}
      </div>
      <div
        style={{
          fontFamily: font.mono,
          fontSize: 9.5,
          color: color.fgMuted,
          marginTop: 2,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </div>
  );
}
