'use client';

import { Button, Card, tokens } from '@declutrmail/shared';
import type { BriefPrefs } from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/** Selectable local hours, 0–23 (D64). */
const HOURS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

/**
 * "8:00 AM" for an hour 0–23.
 *
 * Deliberately NOT `Intl.DateTimeFormat` with the ambient locale: the
 * label would change shape between a viewer's machine, CI and the
 * Storybook baseline, so a frozen story would fail visual regression
 * for a reason that has nothing to do with the component.
 */
export function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

export type BriefPrefsCardState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; prefs: BriefPrefs };

/**
 * Settings → Notifications (D64) — the Daily Brief's delivery hour.
 *
 * The Brief covers the previous local day and generates EVERY day
 * (D66's weekday-only schedule retired 2026-08-25: it meant Saturday's
 * Brief never ran, so Friday's mail was the one day nothing ever
 * summarized). This card owns the one remaining schedule choice — the
 * local hour it lands.
 *
 * Hourly slots, not D64's "any 30-min slot": generation is an hourly
 * cron, so a half-hour choice would silently round up to the next tick.
 * Offering it would be a promise the schedule cannot keep.
 *
 * Dumb component (same contract as EmailPrefsCard): the container owns
 * the PATCH; this card renders state and emits `onChange(hour)`.
 */
export function BriefPrefsCard({
  state,
  timezone,
  onChange,
  pending,
  saveFailed,
}: {
  state: BriefPrefsCardState;
  /** The user's IANA zone, or null when it hasn't been captured yet. */
  timezone: string | null;
  onChange: (hour: number) => void;
  /** True while a PATCH is in flight. */
  pending: boolean;
  /** True when the last PATCH failed (inline error line). */
  saveFailed: boolean;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>Daily Brief</h3>
        <p style={mutedTextStyle}>
          Your Brief covers the previous day and is ready every morning. Pick the hour it lands —
          the change applies to your next Brief, not today&rsquo;s.
        </p>
        {state.kind === 'loading' ? (
          <p role="status" style={mutedTextStyle}>
            Loading Brief preferences…
          </p>
        ) : state.kind === 'error' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: color.danger }}>
              Could not load Brief preferences.
            </span>
            <Button tone="default" size="sm" onClick={state.onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: color.fg }}>Ready at</div>
                <div style={{ fontSize: 12, color: color.fgMuted, marginTop: 2 }}>
                  {timezone
                    ? `Your local time — ${timezone}.`
                    : 'Your local time, once your timezone is detected.'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <select
                  value={state.prefs.hour}
                  disabled={pending}
                  onChange={(e) => onChange(Number(e.target.value))}
                  aria-label="Daily Brief delivery hour"
                  style={selectStyle}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHourLabel(hour)}
                    </option>
                  ))}
                </select>
                <span role="status" style={{ fontSize: 11, color: color.fgMuted, minWidth: 44 }}>
                  {pending ? 'Saving…' : ''}
                </span>
              </div>
            </div>
            {saveFailed && (
              <p role="alert" style={{ fontSize: 12, color: color.danger, margin: '8px 0 0' }}>
                Could not save the delivery time. Try again.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

const selectStyle = {
  fontFamily: font.sans,
  fontSize: 13,
  color: color.fg,
  background: color.card,
  border: `1px solid ${color.line}`,
  borderRadius: 7,
  padding: '6px 8px',
  height: 32,
  boxSizing: 'border-box',
} as const;

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
} as const;
