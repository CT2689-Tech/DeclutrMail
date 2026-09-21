import Link from 'next/link';

import { tokens } from '@declutrmail/shared';
import type { ActivityReviewOutcomeWire, ActivityWeeklyReviewWire } from '@/lib/api/activity';

const { color, font, motion, radius, text } = tokens;

/**
 * The five factual outcomes, in the Filter popover's order and words — a
 * chip here and the active-filter chip it produces must read the same.
 */
export const WEEKLY_OUTCOMES: ReadonlyArray<{ key: ActivityReviewOutcomeWire; label: string }> = [
  { key: 'completed', label: 'Completed' },
  { key: 'skipped', label: 'Dismissed by you' },
  { key: 'failed', label: 'Failed' },
  // A failed action that succeeded on retry — never a user's Undo, which
  // lands in no bucket here (QA-undo-20260828-03).
  { key: 'recovered', label: 'Fixed on retry' },
  { key: 'protected', label: 'Skipped for Protected' },
];

/**
 * Destination for one count. Carries the active sender filter so a
 * click narrows the same way the numbers were counted — without it the
 * strip silently dropped the filter and answered for the whole mailbox
 * (founder decision, 2026-08-19).
 */
export function outcomeHref(
  key: ActivityReviewOutcomeWire,
  review: Pick<ActivityWeeklyReviewWire, 'from' | 'to'>,
  senderQuery: string,
): string {
  const params = new URLSearchParams({
    window: '7d',
    outcome: key,
    date_from: review.from,
    date_to: review.to,
  });
  if (senderQuery) params.set('sender_q', senderQuery);
  return `/activity?${params.toString()}`;
}

/**
 * D246 seven-day review: the label, then one compact tile per outcome
 * that happened. Zero outcomes are left out, and a week with none renders
 * nothing. Each tile opens exactly the records it counts (Failed says
 * "Review"); the active one links back out (`clearHref`).
 */
export function WeeklyReviewStrip({
  review,
  error,
  onRetry,
  activeOutcome,
  clearHref,
  senderQuery = '',
}: {
  review: ActivityWeeklyReviewWire | null;
  error: boolean;
  onRetry: () => void;
  activeOutcome: ActivityReviewOutcomeWire | null;
  /** Where the active chip goes — the current window without the outcome. */
  clearHref: string;
  /** The sender filter these counts were computed under. */
  senderQuery?: string;
}) {
  if (error && !review) {
    return (
      <div role="alert" style={{ fontSize: text.sm, color: color.fgMuted }}>
        Last 7 days couldn’t load.{' '}
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: 0,
            border: 'none',
            background: 'transparent',
            fontFamily: font.sans,
            fontSize: text.sm,
            fontWeight: 600,
            color: color.fg,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!review) return null;
  const shown = WEEKLY_OUTCOMES.filter(({ key }) => review[key] > 0);
  if (shown.length === 0) return null;
  return (
    <section
      aria-labelledby="weekly-review-heading"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <h2
        id="weekly-review-heading"
        style={{ margin: 0, fontSize: text.sm, fontWeight: 600, color: color.fgMuted }}
      >
        Last 7 days{senderQuery ? ' for this sender' : ''}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {shown.map(({ key, label }) => {
          const isActive = activeOutcome === key;
          const isFailed = key === 'failed';
          return (
            <Link
              key={key}
              href={isActive ? clearHref : outcomeHref(key, review, senderQuery)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={`${review[key]} ${label}${isActive ? ', showing — select to clear' : isFailed ? ', Review' : ''}`}
              data-outcome-tile={key}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = color.fillHover;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = color.fill;
              }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minHeight: 64,
                padding: '10px 14px',
                borderRadius: radius.lg,
                background: isActive ? color.primarySoft : color.fill,
                fontFamily: font.sans,
                textDecoration: 'none',
                transition: `background ${motion.fast} ${motion.ease}`,
              }}
            >
              <span
                data-outcome-count={key}
                style={{
                  fontSize: text['2xl'],
                  fontWeight: 650,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.15,
                  fontVariantNumeric: 'tabular-nums',
                  color: isFailed ? color.danger : color.fg,
                }}
              >
                {review[key].toLocaleString('en-US')}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 8,
                  fontSize: text.sm,
                  color: isActive ? color.primary : color.fgMuted,
                }}
              >
                {label}
                {/* The tile already opens the failed records; the word says so. */}
                {isFailed && !isActive && (
                  <span style={{ fontWeight: 600, color: color.danger }}>Review</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
