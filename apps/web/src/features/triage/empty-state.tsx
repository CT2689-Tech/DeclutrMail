'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { TriageSessionStats } from './data';

const { color, font } = tokens;

/**
 * The triage empty state (D33).
 *
 * Five pieces, in this order:
 *
 *   1. Stats summary — what the user got done today (decided / archived
 *      / unsubscribed / later) plus the streak day count. The number
 *      gives the empty state weight — it isn't "nothing to do, the
 *      app is empty"; it's "you cleared the queue today".
 *
 *   2. Estimated impact — D33's "~840 future emails will skip your
 *      inbox / ~12 min/week saved on email triage." Numbers come from
 *      the BE (`futureEmailsSkipped`, `minutesSavedPerWeek`) — both
 *      are `null` when the user has decided nothing today, in which
 *      case the card is hidden so we never brag "0 emails skipped."
 *
 *   3. "Come back tomorrow" — the engine refills the queue overnight
 *      from the next sync sweep + the weekly re-score cron (D25).
 *
 *   4. A subtle upgrade nudge — tier-gated per D17–D21:
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
  const showPlusNudge =
    stats.tier === 'free' && stats.freeRemaining != null && stats.freeRemaining <= 5;
  const showProNudge = stats.tier === 'plus';
  // D33 — only render the impact card when at least one number exists
  // AND the user actually decided something today. The "decidedToday"
  // gate prevents "0 emails skipped" copy on a refresh after the user
  // cleared the queue without any archive/unsub.
  const showImpact =
    stats.decidedToday > 0 &&
    (stats.futureEmailsSkipped != null || stats.minutesSavedPerWeek != null);

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
          The engine refreshes overnight. Come back tomorrow — your next batch will be ready by
          morning sync.
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
        <StatTile label="Unsubscribed" value={stats.unsubscribedToday} />
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
          {stats.streakDays}-day streak · keep it going
        </span>
      )}

      {/* D33 — estimated impact ("~840 future emails / ~12 min/week").
          Hidden when the user decided nothing today, per the rule
          above. */}
      {showImpact && (
        <div
          aria-label="Estimated impact of today's decisions"
          style={{
            width: '100%',
            maxWidth: 520,
            padding: '12px 14px',
            background: color.paper,
            border: `1px dashed ${color.lineSoft}`,
            borderRadius: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            textAlign: 'left',
          }}
        >
          <span
            style={{
              fontFamily: font.mono,
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: color.fgMuted,
            }}
          >
            Estimated impact
          </span>
          {stats.futureEmailsSkipped != null && (
            <span style={{ fontSize: 13, color: color.fgSoft }}>
              ~
              <strong style={{ color: color.fg, fontWeight: 600 }}>
                {stats.futureEmailsSkipped.toLocaleString()}
              </strong>{' '}
              future emails will skip your inbox
            </span>
          )}
          {stats.minutesSavedPerWeek != null && (
            <span style={{ fontSize: 13, color: color.fgSoft }}>
              ~
              <strong style={{ color: color.fg, fontWeight: 600 }}>
                {stats.minutesSavedPerWeek}
              </strong>{' '}
              min/week saved on email triage
            </span>
          )}
        </div>
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
                ? "You've used all 5 free cleanup actions."
                : `${stats.freeRemaining} of your 5 free cleanup actions left.`}
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
