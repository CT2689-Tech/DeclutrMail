'use client';

import { tokens } from '@declutrmail/shared';
import { DEFAULT_EMAIL_PREFS, type EmailPrefs } from '@declutrmail/shared/contracts';
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowStatus,
  SettingsSaveError,
  SettingsSwitch,
} from '../settings-list';

const { color, text } = tokens;

/** Toggleable categories in display order (D165). */
const CATEGORY_ROWS: ReadonlyArray<{
  wire: keyof EmailPrefs;
  label: string;
  detail?: string;
}> = [
  {
    wire: 'syncComplete',
    label: 'Inbox ready email',
    detail: 'One email when we finish scanning a Gmail account you connect.',
  },
  {
    wire: 'reminders',
    label: 'Reminder emails',
    detail: 'Reminders to review your email after a scan or time away.',
  },
  {
    wire: 'briefReady',
    label: 'Daily Brief ready email',
    detail: 'Pro: counts and a link at your local Brief hour. No subjects or previews.',
  },
  {
    wire: 'weeklyReceipt',
    label: 'Weekly activity summary',
    detail: 'Plus and Pro: your weekly cleanup activity and senders awaiting review.',
  },
];

export type EmailPrefsCardState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; prefs: EmailPrefs };

/**
 * Settings → Notifications (D165) — per-category email toggles.
 *
 * One switch per opt-out-able category (`syncComplete`, `reminders`,
 * `weeklyReceipt`);
 * SYSTEM emails (account-deletion notices) are non-opt-out per the
 * CAN-SPAM/GDPR transactional carve-out, so they render as a locked
 * "Always on" row instead of a fake toggle.
 *
 * Dumb component (same contract as ActionSheetPrefsCard): the
 * container owns the PATCH; this renders state + emits
 * `onToggle(wire, next)`. `children` are extra rows the container
 * appends to the same group (the Daily brief hour).
 */
export function EmailPrefsCard({
  state,
  onToggle,
  pendingWire,
  saveFailed,
  children,
}: {
  state: EmailPrefsCardState;
  onToggle: (wire: keyof EmailPrefs, next: boolean) => void;
  /** The category with an in-flight PATCH, or null. */
  pendingWire: keyof EmailPrefs | null;
  /** True when the last toggle PATCH failed (inline error line). */
  saveFailed: boolean;
  children?: React.ReactNode;
}) {
  return (
    <SettingsGroup
      id="notifications"
      title="Email notifications"
      footer={
        saveFailed && state.kind === 'ready' ? (
          <SettingsSaveError>Could not save the preference. Try again.</SettingsSaveError>
        ) : null
      }
    >
      {state.kind === 'ready' ? (
        <>
          {CATEGORY_ROWS.map(({ wire, label, detail }) => {
            const enabled = state.prefs[wire] ?? DEFAULT_EMAIL_PREFS[wire];
            return (
              <SettingsRow key={wire} label={label} detail={detail}>
                <SettingsSwitch
                  ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${label.toLowerCase()}`}
                  on={enabled}
                  stateLabel={enabled ? 'On' : 'Off'}
                  disabled={pendingWire !== null}
                  pending={pendingWire === wire}
                  onToggle={() => onToggle(wire, !enabled)}
                />
              </SettingsRow>
            );
          })}
          <SettingsRow label="Account notices" detail="Deletion confirmations and receipts.">
            <span style={{ fontSize: text.sm, color: color.fgMuted }}>Always on</span>
          </SettingsRow>
        </>
      ) : (
        <SettingsRowStatus
          state={state}
          loadingLabel="Loading email preferences…"
          errorLabel="Could not load email preferences."
        />
      )}
      {children}
    </SettingsGroup>
  );
}
