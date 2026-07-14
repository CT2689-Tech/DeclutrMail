'use client';

import { Button, Card, tokens } from '@declutrmail/shared';
import type { ActionSheetPrefs } from '@declutrmail/shared/contracts';

const { color, font } = tokens;

/** Wire keys in display order, with their user-facing KAULD verb. */
const VERB_ROWS: ReadonlyArray<{
  wire: keyof ActionSheetPrefs;
  verb: 'Archive' | 'Unsubscribe' | 'Later';
  detail: string;
}> = [
  {
    wire: 'archive',
    verb: 'Archive',
    detail: 'Moves matching inbox mail to Gmail All Mail, where it stays searchable.',
  },
  {
    wire: 'unsubscribe',
    verb: 'Unsubscribe',
    detail: 'Asks the sender to stop future mail; the sender controls the outcome and timing.',
  },
  {
    wire: 'later',
    verb: 'Later',
    detail: 'Moves matching inbox mail to the untimed DeclutrMail/Later label.',
  },
];

export type ActionSheetPrefsCardState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; prefs: ActionSheetPrefs };

/**
 * Settings → Action preferences (D34) — per-verb "skip the action
 * sheet" toggles.
 *
 * D226 copy contract: the card states explicitly that the action
 * PREVIEW always renders — only the confirmation sheet is skippable.
 * Keep is absent by design (non-destructive, never sheeted).
 *
 * Dumb component: the container owns the PATCH + persistence; this
 * card renders state + emits `onToggle(wire, next)`.
 */
export function ActionSheetPrefsCard({
  state,
  onToggle,
  pendingWire,
  saveFailed,
}: {
  state: ActionSheetPrefsCardState;
  onToggle: (wire: keyof ActionSheetPrefs, next: boolean) => void;
  /** The wire key with an in-flight PATCH, or null. */
  pendingWire: keyof ActionSheetPrefs | null;
  /** True when the last toggle PATCH failed (inline error line). */
  saveFailed: boolean;
}) {
  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>
          Action preferences
        </h3>
        <p style={mutedTextStyle}>
          Skip the confirmation sheet per action. The action preview always shows before anything
          changes — these toggles only skip the sheet around it. Synced to your account, so the
          choice follows you across devices.
        </p>

        {state.kind === 'loading' ? (
          <p role="status" style={mutedTextStyle}>
            Loading action preferences…
          </p>
        ) : state.kind === 'error' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <span style={{ fontSize: 13, color: color.danger }}>
              Could not load action preferences.
            </span>
            <Button tone="default" size="sm" onClick={state.onRetry}>
              Retry
            </Button>
          </div>
        ) : (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
            {VERB_ROWS.map(({ wire, verb, detail }, i) => (
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
                  <div style={{ fontSize: 13.5, fontWeight: 500, color: color.fg }}>
                    Skip the sheet for {verb}
                  </div>
                  <div style={{ fontSize: 12, color: color.fgMuted, marginTop: 2 }}>{detail}</div>
                </div>
                <SkipSwitch
                  verb={verb}
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
          </div>
        )}
      </div>
    </Card>
  );
}

/** Switch-style toggle — same shape as Autopilot's EnabledSwitch. */
function SkipSwitch({
  verb,
  on,
  disabled,
  pending,
  onToggle,
}: {
  verb: string;
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
      aria-label={`${on ? 'Show' : 'Skip'} the action sheet for ${verb}`}
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
        {pending ? 'Saving…' : on ? 'Skip' : 'Show'}
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
