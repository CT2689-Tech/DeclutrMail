'use client';

import { Button, tokens } from '@declutrmail/shared';
import type { TriageSessionStats } from './data';

const { color, font } = tokens;

/**
 * The triage empty state (D33).
 *
 * Three pieces, in this order:
 *
 *   1. Stats summary — what the user got done today (decided / archived
 *      / unsubscribed / later) plus the streak day count. The number
 *      gives the empty state weight — it isn't "nothing to do, the
 *      app is empty"; it's "you cleared the queue today".
 *
 *   2. "Come back tomorrow" — the engine refills the queue overnight
 *      from the next sync sweep + the weekly re-score cron (D25).
 *
 *   3. A subtle upgrade nudge — surfaces only when the user is on the
 *      free tier and has hit the daily-decision cap. `stats.freeRemaining`
 *      controls the visibility; `null` means the user is on Plus/Pro
 *      and the nudge is hidden.
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
  const showUpgrade = stats.freeRemaining != null && stats.freeRemaining <= 5;

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

      {showUpgrade && (
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
                ? "You're out of free decisions today."
                : `Only ${stats.freeRemaining} free decisions left today.`}
            </strong>{' '}
            <span style={{ color: color.fgSoft }}>
              Plus removes the daily cap and unlocks Autopilot rules.
            </span>
          </span>
          <Button tone="primary" size="sm" onClick={onOpenUpgrade ?? (() => {})}>
            See Plus
          </Button>
        </div>
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
