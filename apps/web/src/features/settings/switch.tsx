'use client';

import { tokens } from '@declutrmail/shared';

const { color, motion, radius, shadow } = tokens;

const TRACK_W = 44;
const TRACK_H = 26;
const KNOB = 22;
const INSET = (TRACK_H - KNOB) / 2;

/**
 * The one switch (ADR-0042): a 44×26 capsule track, teal when on, with a
 * raised knob that slides. `SwitchTrack` is the visual alone — for a
 * caller whose own `role="switch"` button wraps a label as well; `Switch`
 * is the complete control.
 */
const SWITCH_CSS = `.dm-switch-track { transition: background ${motion.base} ${motion.ease}; }
.dm-switch-knob { transition: transform ${motion.base} ${motion.ease}; background: ${color.card}; }
.dm-switch-track[data-on='true'] .dm-switch-knob { background: ${color.fgInverse}; }
[data-theme='dark'] .dm-switch-track[data-on='false'] .dm-switch-knob { background: ${color.fgSoft}; }`;

export function SwitchTrack({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="dm-switch-track"
      data-on={on ? 'true' : 'false'}
      style={{
        display: 'inline-block',
        position: 'relative',
        width: TRACK_W,
        height: TRACK_H,
        borderRadius: radius.pill,
        background: on ? color.primary : color.fillHover,
        flexShrink: 0,
      }}
    >
      <style>{SWITCH_CSS}</style>
      <span
        className="dm-switch-knob"
        style={{
          position: 'absolute',
          top: INSET,
          left: INSET,
          width: KNOB,
          height: KNOB,
          borderRadius: radius.pill,
          boxShadow: shadow.card,
          transform: `translateX(${on ? TRACK_W - KNOB - INSET * 2 : 0}px)`,
        }}
      />
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  ariaLabel,
  ariaDescribedBy,
  disabled = false,
  id,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  ariaDescribedBy?: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      data-testid={testId}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // 44px tall hit area around a 26px track.
        minHeight: 44,
        padding: 0,
        background: 'transparent',
        border: 'none',
        borderRadius: radius.pill,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <SwitchTrack on={checked} />
    </button>
  );
}
