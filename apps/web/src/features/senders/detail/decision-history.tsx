'use client';

import { Eyebrow, EmptyState, Pill, tokens } from '@declutrmail/shared';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { relTimeFromIso } from './data';
import type { DecisionAction, DecisionHistoryRow } from './types';

const { color, font, radius } = tokens;

/** Pill tone per action — keeps the list scannable without colour overload. */
function toneFor(
  action: DecisionAction,
): 'default' | 'primary' | 'amber' | 'emerald' | 'red' | 'dark' {
  switch (action) {
    case 'Archived':
    case 'Moved to Later':
      return 'default';
    case 'Unsubscribe request recorded':
      return 'amber';
    case 'Deleted to Gmail Trash':
      return 'red';
    case 'Keep decision saved':
      return 'primary';
    case 'Protected':
    case 'Unprotected':
      return 'emerald';
    case 'Restored':
      return 'dark';
  }
}

/**
 * Locale + zone pinned to close the D200 hydration-determinism class
 * (React #418; e2e hydration-smoke). NOTE: this component is currently
 * unmounted — /senders/[id] replaced it with DecisionTimeline and its
 * deletion is deferred (see sender-detail-page.tsx) — the pin keeps the
 * retained file compliant with the features-wide lint ban. Exported for
 * the exact-string unit test.
 */
export function dateLabel(iso: string, now: Date, timeZone: string): string {
  const then = new Date(iso);
  const ageDays = (now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return relTimeFromIso(iso, now);
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
}

/**
 * Decision history (D39 #7, D46).
 *
 * Up to 10 most-recent V2 actions on this sender, inline. Each row
 * shows the relative/absolute date, the source, the action pill,
 * the email count (if applicable), the operation id (mono, tooltip
 * on hover), and an Undo link if the action is still in its 7-day
 * window. Footer links to the full Activity log pre-filtered to this
 * sender.
 *
 * Undo emits to a parent callback so the page can wire the same
 * preview → mutation → undo lifecycle that the action toolbar uses.
 */
export function DecisionHistory({
  history,
  senderId,
  onUndo,
}: {
  history: DecisionHistoryRow[];
  senderId: string;
  onUndo?: (row: DecisionHistoryRow) => void;
}) {
  const now = new Date();
  const timeZone = useUserTimeZone();
  return (
    <section
      aria-label="Decision history"
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: '16px 20px',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <Eyebrow>Decision history</Eyebrow>
          <h2
            style={{
              margin: '4px 0 0',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: color.fg,
            }}
          >
            Last {history.length} action{history.length === 1 ? '' : 's'} on this sender
          </h2>
        </div>
        <a
          href={`/activity?sender=${encodeURIComponent(senderId)}`}
          style={{
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgSoft,
            textDecoration: 'none',
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          View full history →
        </a>
      </div>

      {history.length === 0 ? (
        <EmptyState
          title="No decisions yet"
          body="Once you Keep, Archive, Unsubscribe, or move this sender to Later, you'll see the history here."
        />
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {history.map((row, idx) => {
            const undoActive =
              row.undoExpiresAt != null && new Date(row.undoExpiresAt).getTime() > now.getTime();
            return (
              <li
                key={row.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(80px, auto) minmax(80px, auto) 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderTop: idx === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontFamily: font.mono,
                    fontSize: 11.5,
                    color: color.fgSoft,
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {dateLabel(row.at, now, timeZone)}
                </span>
                <span
                  style={{
                    fontFamily: font.sans,
                    fontSize: 12,
                    color: color.fgMuted,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.source}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    minWidth: 0,
                    flexWrap: 'wrap',
                  }}
                >
                  <Pill tone={toneFor(row.action)}>{row.action}</Pill>
                  {row.count != null && (
                    <span
                      style={{
                        fontFamily: font.mono,
                        fontSize: 11,
                        color: color.fgMuted,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {row.count.toLocaleString('en-US')} email{row.count === 1 ? '' : 's'}
                    </span>
                  )}
                </span>
                <span
                  title={row.opId}
                  style={{
                    fontFamily: font.mono,
                    fontSize: 10.5,
                    color: color.fgMuted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: 120,
                  }}
                >
                  {row.opId}
                </span>
                {undoActive && onUndo != null ? (
                  <button
                    type="button"
                    onClick={() => onUndo(row)}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${color.border}`,
                      borderRadius: radius.sm,
                      padding: '3px 9px',
                      fontFamily: font.sans,
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: color.primary,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Undo
                  </button>
                ) : (
                  <span style={{ width: 1 }} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
