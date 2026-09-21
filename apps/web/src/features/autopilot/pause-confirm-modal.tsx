'use client';

import { tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';

const { color, space, text } = tokens;

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
  onCancel,
  onConfirm,
  isPausing,
  pauseError,
}: {
  open: boolean;
  rules: AutopilotRuleDto[];
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

  return (
    <ConfirmModalFrame
      title={n === 0 ? 'Nothing to pause' : `Pause ${n} Autopilot rule${n === 1 ? '' : 's'}?`}
      subtitle={
        n === 0
          ? 'No rules are running.'
          : 'No new suggestions and no automated actions. Pending suggestions stay.'
      }
      note={n === 0 ? undefined : 'Turn each rule back on from the rules list.'}
      confirmLabel="Pause all"
      confirmBusyLabel="Pausing…"
      canConfirm={n > 0}
      isBusy={isPausing}
      error={pauseError}
      onCancel={onCancel}
      onConfirm={onConfirm}
      details={
        n === 0 ? undefined : (
          <ul
            aria-label="Rules that will pause"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {affected.map((r, i) => (
              <li
                key={r.id}
                style={{
                  padding: `${space[2]}px 0`,
                  borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                  fontSize: text.base,
                  fontWeight: 600,
                  color: color.fg,
                }}
              >
                {presetDisplayName(r.presetKey, r.name)}
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
