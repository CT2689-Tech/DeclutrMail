'use client';

import type { ActionSheetPrefs } from '@declutrmail/shared/contracts';
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowStatus,
  SettingsSaveError,
  SettingsSwitch,
} from '../settings-list';

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

/**
 * Settings → Actions (D34) — per-verb preview placement.
 *
 * D226: the action PREVIEW always renders; only where it lands is a
 * preference. The switch's state word says exactly that — "Row" or
 * "Window" — so neither value reads as "no preview". Keep is absent by
 * design (non-destructive, never sheeted).
 *
 * Dumb component: the container owns the PATCH + persistence; this
 * renders state + emits `onToggle(wire, next)`. `children` are extra
 * rows the container appends to the same group.
 */
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
      {state.kind === 'ready' ? (
        VERB_ROWS.map(({ wire, verb }) => (
          <SettingsRow
            key={wire}
            label={`${verb} preview in the row`}
            detail="The preview always appears. Choose inline in the sender row or in a separate window."
          >
            <SettingsSwitch
              ariaLabel={`Show the ${verb} preview in the row`}
              on={state.prefs[wire]}
              // States where the preview lands. 'Skip'/'Show' named the
              // SHEET — a word this group never shows — and read as the
              // inverse of the "…in the row" label.
              stateLabel={state.prefs[wire] ? 'Inline' : 'Separate window'}
              disabled={pendingWire !== null}
              pending={pendingWire === wire}
              onToggle={() => onToggle(wire, !state.prefs[wire])}
            />
          </SettingsRow>
        ))
      ) : (
        <SettingsRowStatus
          state={state}
          loadingLabel="Loading action preferences…"
          errorLabel="Could not load action preferences."
        />
      )}
      {children}
    </SettingsGroup>
  );
}
