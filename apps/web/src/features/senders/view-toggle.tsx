'use client';

/**
 * `ViewToggle` — segmented `[Grid | Table]` control (D49).
 *
 * D49: "Every page visit starts in grid. Segmented control at top
 * right offers `[Grid | Table]` switch. Toggle does not persist
 * across sessions."
 *
 * State lives in `useSendersStore` (D200) so the toggle can be
 * read/set from anywhere on the screen without prop drilling. Mount
 * always defaults to `grid` (the store's initial state) — see store
 * comment for why the toggle deliberately does not persist.
 */

import { tokens } from '@declutrmail/shared';
import { useSendersStore, type SendersView } from './store';

const { color, font } = tokens;

const OPTIONS: Array<{ value: SendersView; label: string }> = [
  { value: 'grid', label: 'Grid' },
  { value: 'table', label: 'Table' },
];

export function ViewToggle() {
  const view = useSendersStore((s) => s.view);
  const setView = useSendersStore((s) => s.setView);

  return (
    <div
      role="group"
      aria-label="View"
      style={{
        display: 'inline-flex',
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: 8,
        padding: 2,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = view === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setView(opt.value)}
            aria-pressed={active}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              background: active ? color.fg : 'transparent',
              color: active ? color.fgInverse : color.fgSoft,
              border: 'none',
              fontFamily: font.sans,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 120ms, color 120ms',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
