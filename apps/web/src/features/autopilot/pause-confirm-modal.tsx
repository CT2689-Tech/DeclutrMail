'use client';

import { tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';

const { color, space, text } = tokens;

export interface PauseRuleScope {
  rules: readonly (Pick<AutopilotRuleDto, 'id' | 'name' | 'mode'> &
    Partial<Pick<AutopilotRuleDto, 'presetKey'>>)[];
  complete: boolean;
}

/**
 * D105 master-pause confirmation.
 *
 * Per D226 every Autopilot mutation must render a "what happens next"
 * preview before the mutation runs. Pause-all is non-destructive (it
 * doesn't delete or move any mail; it just stops new matches from
 * landing in the buffer) but it touches every running rule — exactly the
 * surface D226's "preview is mandatory" rule was written for. Details
 * enumerates the affected rules so the user sees what they are flipping.
 *
 * Keyboard: Escape cancels; ⌘/Ctrl + Enter confirms (same guard as the
 * button: never while in flight, never when nothing would change).
 */
export function PauseConfirmModal({
  open,
  rules,
  complete = true,
  onCancel,
  onConfirm,
  isPausing,
  pauseError,
}: {
  open: boolean;
  rules: PauseRuleScope['rules'];
  complete?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isPausing: boolean;
  pauseError: string | null;
}) {
  if (!open) return null;

  // Only currently non-paused rules will flip — show the exact set the
  // mutation touches, not the full rule library.
  const affected = rules.filter((r) => r.mode !== 'paused');
  const n = affected.length;
  const nothingToPause = complete && n === 0;

  return (
    <ConfirmModalFrame
      title={
        !complete
          ? 'Pause all Autopilot rules?'
          : nothingToPause
            ? 'Nothing to pause'
            : `Pause ${n} Autopilot rule${n === 1 ? '' : 's'}?`
      }
      subtitle={
        nothingToPause
          ? 'No rules are running.'
          : 'No new suggestions and no automated actions. Pending suggestions stay.'
      }
      note={
        !complete
          ? 'The complete rule list is unavailable. All rules in this mailbox will pause.'
          : nothingToPause
            ? undefined
            : 'Turn each rule back on from the rules list.'
      }
      confirmLabel="Pause all"
      confirmBusyLabel="Pausing…"
      canConfirm={!complete || n > 0}
      isBusy={isPausing}
      error={pauseError}
      onCancel={onCancel}
      onConfirm={onConfirm}
      details={
        !complete || n === 0 ? undefined : (
          <ul
            aria-label="Rules that will pause"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: `${space[3]}px 0 ${space[1]}px`,
              display: 'flex',
              flexDirection: 'column',
              gap: space[2],
            }}
          >
            {affected.map((r) => (
              <li
                key={r.id}
                style={{
                  fontSize: text.base,
                  fontWeight: 600,
                  color: color.fg,
                }}
              >
                {r.presetKey == null ? r.name : presetDisplayName(r.presetKey, r.name)}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
