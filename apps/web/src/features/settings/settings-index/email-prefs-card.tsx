'use client';

import { Button, Card, tokens } from '@declutrmail/shared';
import type { EmailPrefs } from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/** Toggleable categories in display order (D165). */
const CATEGORY_ROWS: ReadonlyArray<{
  wire: keyof EmailPrefs;
  label: string;
  detail: string;
}> = [
  {
    wire: 'syncComplete',
    label: 'Sync completion alerts',
    detail: '"Your inbox is ready" when a mailbox finishes indexing.',
  },
  {
    wire: 'reminders',
    label: 'Reminder emails',
    detail: 'The 24-hour "your inbox is still ready" nudge and similar re-engagement reminders.',
  },
];

export type EmailPrefsCardState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; prefs: EmailPrefs };

/**
 * Settings → Notifications (D165) — per-category email toggles.
 *
 * One switch per opt-out-able category (`syncComplete`, `reminders`);
 * SYSTEM emails (account-deletion notices) are non-opt-out per the
 * CAN-SPAM/GDPR transactional carve-out, so they render as a locked
 * "always send" row instead of a fake toggle.
 *
 * Dumb component (same contract as ActionSheetPrefsCard): the
 * container owns the PATCH; this card renders state + emits
 * `onToggle(wire, next)`.
 */
export function EmailPrefsCard({
  state,
  onToggle,
  pendingWire,
  saveFailed,
}: {
  state: EmailPrefsCardState;
  onToggle: (wire: keyof EmailPrefs, next: boolean) => void;
  /** The category with an in-flight PATCH, or null. */
  pendingWire: keyof EmailPrefs | null;
  /** True when the last toggle PATCH failed (inline error line). */
  saveFailed: boolean;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Email notifications
        </h3>
        <p style={mutedTextStyle}>
          Which emails DeclutrMail sends you, per category. Changes apply to the very next queued
          email.
        </p>
        {state.kind === 'loading' ? (
          <p role="status" style={mutedTextStyle}>
            Loading email preferences…
          </p>
        ) : state.kind === 'error' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: color.danger }}>
              Could not load email preferences.
            </span>
            <Button tone="default" size="sm" onClick={state.onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
            {CATEGORY_ROWS.map(({ wire, label, detail }, i) => (
              <div
                key={wire}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 0',
                  borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: color.fg }}>{label}</div>
                  <div style={{ fontSize: 12, color: color.fgMuted, marginTop: 2 }}>{detail}</div>
                </div>
                <PrefSwitch
                  label={label}
                  on={state.prefs[wire]}
                  disabled={pendingWire !== null}
                  pending={pendingWire === wire}
                  onToggle={() => onToggle(wire, !state.prefs[wire])}
                />
              </div>
            ))}
            {saveFailed && (
              <p role="alert" style={{ fontSize: 12, color: color.danger, margin: '6px 0 0' }}>
                Could not save the preference. Try again.
              </p>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 0 0',
                borderTop: `1px solid ${color.lineSoft}`,
                marginTop: 4,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500, color: color.fg }}>
                  Account notices
                </div>
                <div style={{ fontSize: 12, color: color.fgMuted, marginTop: 2 }}>
                  Deletion confirmations and receipts always send — they document actions on your
                  account.
                </div>
              </div>
              <span style={{ fontSize: 11, color: color.fgMuted, flexShrink: 0 }}>Always on</span>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Switch-style toggle — same shape as ActionSheetPrefsCard's SkipSwitch. */
function PrefSwitch({
  label,
  on,
  disabled,
  pending,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${on ? 'Disable' : 'Enable'} ${label.toLowerCase()}`}
      onClick={onToggle}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && !pending ? 0.6 : 1,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: 11, color: color.fgMuted, minWidth: 34, textAlign: 'right' }}>
        {pending ? 'Saving…' : on ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          background: on ? color.primary : color.mutedBg,
          border: `1px solid ${on ? color.primary : color.border}`,
          position: 'relative',
          transition: 'background 120ms',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: on ? 15 : 1,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: '#FFFFFF',
            boxShadow: '0 1px 2px rgba(14,20,19,0.25)',
            transition: 'left 120ms',
          }}
        />
      </span>
    </button>
  );
}

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
} as const;
