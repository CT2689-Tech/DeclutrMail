'use client';

import { tokens } from '@declutrmail/shared';
import type { BriefPrefs } from '@declutrmail/shared/contracts';
import { SettingsRow, SettingsRowStatus, SettingsSaveError } from '../settings-list';

const { color, font, text, radius } = tokens;

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
 * Settings → Notifications (D64) — the Daily Brief's delivery hour,
 * rendered as one row inside the Notifications group.
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
 * the PATCH; this row renders state and emits `onChange(hour)`.
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
  if (state.kind !== 'ready') {
    return (
      <SettingsRowStatus
        state={state}
        loadingLabel="Loading Brief preferences…"
        errorLabel="Could not load Brief preferences."
      />
    );
  }
  return (
    <>
      <SettingsRow
        label="Daily Brief ready at"
        // The zone is the one thing that changes what the user picks.
        detail={timezone ?? 'Timezone not detected yet.'}
      >
        <span role="status" style={{ fontSize: text.sm, color: color.fgMuted }}>
          {pending ? 'Saving…' : ''}
        </span>
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
      </SettingsRow>
      {saveFailed && (
        <SettingsSaveError>Could not save the delivery time. Try again.</SettingsSaveError>
      )}
    </>
  );
}

const selectStyle = {
  fontFamily: font.sans,
  fontSize: text.md,
  color: color.fg,
  background: color.card,
  border: `1px solid ${color.line}`,
  borderRadius: radius.md,
  padding: '6px 8px',
  height: 32,
  boxSizing: 'border-box',
} as const;
