'use client';

import { useId } from 'react';
import { tokens } from '@declutrmail/shared';
import type { ActionSheetPrefs } from '@declutrmail/shared/contracts';
import { SettingsGroup, SettingsRow, SettingsRowStatus, SettingsSaveError } from '../settings-list';

/** Wire keys in display order, with their user-facing KAULD verb. */
const VERB_ROWS: ReadonlyArray<{
  wire: keyof ActionSheetPrefs;
  verb: 'Archive' | 'Unsubscribe' | 'Later';
}> = [
  { wire: 'archive', verb: 'Archive' },
  { wire: 'unsubscribe', verb: 'Unsubscribe' },
  { wire: 'later', verb: 'Later' },
];

export type ActionSheetPrefsCardState =
  | { kind: 'loading' }
  | { kind: 'error'; onRetry: () => void }
  | { kind: 'ready'; prefs: ActionSheetPrefs };

/** Preview placement for Triage; true persists the inline choice. */
export function ActionSheetPrefsCard({
  state,
  onToggle,
  pendingWire,
  saveFailed,
  children,
}: {
  state: ActionSheetPrefsCardState;
  onToggle: (wire: keyof ActionSheetPrefs, next: boolean) => void;
  /** The wire key with an in-flight PATCH, or null. */
  pendingWire: keyof ActionSheetPrefs | null;
  /** True when the last toggle PATCH failed (inline error line). */
  saveFailed: boolean;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <SettingsGroup
      id="actions"
      title="Action previews"
      footer={
        saveFailed && state.kind === 'ready' ? (
          <SettingsSaveError>Could not save the preference. Try again.</SettingsSaveError>
        ) : null
      }
    >
      <p
        style={{
          margin: 0,
          padding: '16px 16px 8px',
          color: tokens.color.fgMuted,
          fontSize: tokens.text.sm,
          lineHeight: 1.5,
        }}
      >
        Choose where previews open in Triage. Senders and sender details use a separate window.
      </p>
      {state.kind === 'ready' ? (
        VERB_ROWS.map(({ wire, verb }) => (
          <SettingsRow
            key={wire}
            label={verb}
            detail={pendingWire === wire ? <span role="status">Saving…</span> : undefined}
            style={{ paddingBlock: 12 }}
          >
            <fieldset
              aria-label={`${verb} preview placement`}
              disabled={pendingWire !== null}
              className="dm-preview-placement"
              style={{
                display: 'flex',
                margin: 0,
                padding: 4,
                gap: 4,
                border: `1px solid ${tokens.color.border}`,
                borderRadius: tokens.radius.md,
                background: tokens.color.fill,
                minWidth: 0,
              }}
            >
              {[
                { value: true, label: 'Inline' },
                { value: false, label: 'Separate window' },
              ].map((choice) => (
                <label key={choice.label} className="dm-preview-choice">
                  <input
                    type="radio"
                    name={`${id}-${wire}`}
                    value={String(choice.value)}
                    checked={state.prefs[wire] === choice.value}
                    onChange={() => onToggle(wire, choice.value)}
                  />
                  <span>{choice.label}</span>
                </label>
              ))}
            </fieldset>
          </SettingsRow>
        ))
      ) : (
        <SettingsRowStatus
          state={state}
          loadingLabel="Loading action preferences…"
          errorLabel="Could not load action preferences."
        />
      )}
      <SettingsRow
        label="Delete"
        detail="Always opens a separate confirmation window."
        style={{ paddingBlock: 12 }}
      />
      <style>{`
        .dm-preview-choice { position: relative; cursor: pointer; }
        .dm-preview-choice input { position: absolute; opacity: 0; width: 1px; height: 1px; }
        .dm-preview-choice span { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 12px; border-radius: ${tokens.radius.sm}px; font-size: ${tokens.text.sm}px; font-weight: 500; color: ${tokens.color.fgSoft}; }
        .dm-preview-choice input:checked + span { background: ${tokens.color.card}; color: ${tokens.color.fg}; box-shadow: ${tokens.shadow.button}; }
        .dm-preview-choice input:focus-visible + span { outline: 2px solid ${tokens.color.primary}; outline-offset: 1px; }
        .dm-preview-placement:disabled { opacity: .6; }
        .dm-preview-placement:disabled .dm-preview-choice { cursor: default; }
      `}</style>
      {children}
    </SettingsGroup>
  );
}
