'use client';

import { useEffect } from 'react';
import { tokens } from '@declutrmail/shared';
import { captureFeatureException } from '@/lib/sentry';
import { useTodaySummary, type TodaySummary } from './api/use-triage-queue';

const { color, font } = tokens;

/**
 * D214 — the "Today" strip atop Triage. Situational awareness for the
 * daily ritual, rendered INSIDE the Triage screen (no separate /home
 * route — D214's hard rule; D3's screen count holds).
 *
 *   Today
 *   You received 184 emails from 63 senders.
 *   DeclutrMail handled 129 automatically.
 *   12 sender decisions can reduce future noise by ~38%.
 *
 * Copy rules: the queue count reads as DECISIONS, never senders or
 * emails (D221 canonical phrasing). Numbers are the BE's real
 * aggregates — never client estimates (§10 no fake completion).
 *
 * States (D211 — designed, not accidental):
 *   - loading → nothing. The strip is an enhancement above the queue;
 *     a skeleton flash for three lines of copy is more distracting
 *     than a strip that settles in.
 *   - error   → nothing rendered, but the failure is OBSERVED
 *     (captureFeatureException) — never an invisible swallow. The
 *     queue below has its own first-class error state; the ritual
 *     never blocks on the strip.
 *   - data    → the lines below, each hidden when its number would be
 *     a hollow zero.
 */
export function TodayStrip() {
  const summary = useTodaySummary();

  useEffect(() => {
    if (!summary.isError) return;
    captureFeatureException(summary.error, {
      surface: 'triage',
      reason: 'today_summary',
    });
  }, [summary.isError, summary.error]);

  if (summary.data == null) return null;
  return <TodayStripView summary={summary.data} />;
}

/**
 * Presentational half — split from the fetching wrapper so Storybook
 * and the SSR-shape tests can render every copy variant without a
 * network (same split as senders' `CheatsheetPanel`).
 */
export function TodayStripView({ summary }: { summary: TodaySummary }) {
  const showReceived = summary.receivedToday > 0;
  const showHandled = summary.handledAutomatically > 0;
  const showDecisions = summary.queuedDecisions > 0;
  // A fresh mailbox with nothing received, handled, or queued has no
  // situational awareness to show — the D212 empty state below the
  // strip already owns that moment.
  if (!showReceived && !showHandled && !showDecisions) return null;

  return (
    <section
      aria-label="Today at a glance"
      style={{
        padding: '12px 16px',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        fontFamily: font.sans,
      }}
    >
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: color.fgMuted,
          marginBottom: 2,
        }}
      >
        Today
      </span>
      {showReceived && (
        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
          You received{' '}
          <strong style={{ color: color.fg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {summary.receivedToday.toLocaleString()}
          </strong>{' '}
          email{summary.receivedToday === 1 ? '' : 's'} from{' '}
          <strong style={{ color: color.fg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {summary.sendersToday.toLocaleString()}
          </strong>{' '}
          sender{summary.sendersToday === 1 ? '' : 's'}.
        </span>
      )}
      {showHandled && (
        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
          DeclutrMail handled{' '}
          <strong style={{ color: color.fg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {summary.handledAutomatically.toLocaleString()}
          </strong>{' '}
          automatically.
        </span>
      )}
      {showDecisions && (
        <span style={{ fontSize: 12.5, color: color.fgSoft }}>
          <strong style={{ color: color.fg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {summary.queuedDecisions.toLocaleString()}
          </strong>{' '}
          sender decision{summary.queuedDecisions === 1 ? '' : 's'}
          {summary.noiseReductionPct != null && summary.noiseReductionPct > 0 ? (
            <>
              {' '}
              can reduce future noise by ~
              <strong
                style={{ color: color.fg, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              >
                {summary.noiseReductionPct}%
              </strong>
              .
            </>
          ) : (
            <> waiting below.</>
          )}
        </span>
      )}
    </section>
  );
}
