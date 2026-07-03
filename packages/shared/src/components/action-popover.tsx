// packages/shared/src/components/action-popover.tsx
//
// ActionPopover (ADR-0019, spec v1.2 Decision 9) — the `⋯` overflow
// menu that renders every K/A/U/L/D verb from the Verb Registry on
// every Senders surface (SenderCard, SenderTable row, SenderDetail
// action toolbar, mobile bottom-sheet). Single component replaces
// the four hand-rolled verb-to-button rows that previously drifted.
//
// Layout: full-word label + `kbd` shortcut chip + optional icon +
// tone-colored hover state. Delete entry renders a 1px hairline
// divider above (`separator: true` in registry).
//
// Behavior: ESC closes; arrow keys navigate; Enter activates;
// click-outside closes. Focus-trapped while open via the existing
// `useFocusTrap` hook (D211 a11y compliance).
//
// PRIVACY (D7, D228): UI metadata only. No PII, no wire-data.
//
// Consumed by:
//   - apps/web/src/features/senders/grid/sender-card.tsx
//   - apps/web/src/features/senders/sender-table/sender-table.tsx
//   - apps/web/src/features/senders/detail/* action toolbar
//   - apps/web/src/features/senders/mobile/* (Phase 4)

'use client';

import { useEffect, type CSSProperties, type ReactNode } from 'react';
import {
  VERB_REGISTRY,
  verbById,
  type VerbId,
  type VerbSpec,
  type VerbTone,
} from '../actions/verb-registry';
import { tokens } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';

const { color, font, radius, shadow } = tokens;

/**
 * Map FE `VerbTone` to a concrete fg color from the token palette.
 * Centralized here so callers don't need to import tokens AND the
 * tone semantic separately — the registry already declares the tone,
 * the popover resolves it once.
 *
 * `danger` resolves to `color.danger` (added Phase 0 of the D38
 * prod-ready pass; FOUNDER-FOLLOWUPS 2026-06-05). Was inlined as
 * `#DC2626` while the token was queued; now dereferences the token.
 */
const TONE_TO_FG: Record<VerbTone, string> = {
  neutral: color.fg,
  dark: color.fg,
  amber: color.amber,
  primary: color.primary,
  danger: color.danger,
};

export interface ActionPopoverProps {
  /**
   * Verb ids to render. Default = the full registry. Pass a subset
   * when the call-site needs to filter (e.g. SelectionBar omits Keep
   * since bulk = move workflow).
   */
  verbs?: readonly VerbId[];

  /**
   * Optional capability map — verbs not capable on this sender
   * render disabled (greyed + non-clickable). Defaults to all
   * capable. SenderCard passes the existing `canArchive` /
   * `canUnsubscribe` / `canLater` flags via this map.
   */
  capabilities?: Partial<Record<VerbId, boolean>>;

  /**
   * Optional dimmed-already-selected verb (rendered with reduced
   * opacity to signal "already showing as your primary CTA"). The
   * verb is still clickable — useful when the user wants to re-fire
   * the primary action from the popover.
   */
  dimmedVerb?: VerbId;

  /** Fired when user picks a verb. Caller routes through D226 preview. */
  onPick: (verbId: VerbId) => void;

  /** Fired when popover should close (ESC, click-outside, or after pick). */
  onClose: () => void;

  /**
   * Aria-label for the popover container; defaults to "Sender actions".
   * Override when the popover represents a different context
   * (e.g. "Bulk actions" for SelectionBar).
   */
  ariaLabel?: string;

  /** Optional style overrides for positioning. */
  style?: CSSProperties;
}

/**
 * `<ActionPopover>` — render a K/A/U/L/D overflow menu.
 *
 * Self-closes on the keyboard-shortcut pick path only; the CLICK path
 * leaves closing to the consumer — call `onClose()` inside your
 * `onPick` (both `SenderActionRow` consumers do). The trigger (`⋯`
 * button) lives at each call-site; this component is purely the
 * dropdown surface.
 */
export function ActionPopover({
  verbs = VERB_REGISTRY.map((v) => v.id),
  capabilities = {},
  dimmedVerb,
  onPick,
  onClose,
  ariaLabel = 'Sender actions',
  style,
}: ActionPopoverProps) {
  const ref = useFocusTrap<HTMLDivElement>(true);

  // Keyboard nav: ↑↓ navigate, Enter activates, Esc closes. Click-
  // outside closes via the global mousedown listener below.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        if (!buttons || buttons.length === 0) return;
        const arr = Array.from(buttons);
        const active = document.activeElement;
        const i = arr.findIndex((b) => b === active);
        const next =
          e.key === 'ArrowDown'
            ? arr[(i + 1) % arr.length]
            : arr[(i - 1 + arr.length) % arr.length];
        next?.focus();
      }
      // Shortcut keys — let the registry-shortcut fire a pick.
      const verb = VERB_REGISTRY.find((v) => v.shortcut.toLowerCase() === e.key.toLowerCase());
      if (verb && verbs.includes(verb.id) && capabilities[verb.id] !== false) {
        e.preventDefault();
        onPick(verb.id);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [verbs, capabilities, onPick, onClose]);

  // Click-outside closes.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer one tick so the opening click doesn't immediately close.
    const t = setTimeout(() => document.addEventListener('mousedown', onClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.md,
        padding: 6,
        minWidth: 220,
        fontFamily: font.sans,
        boxShadow: shadow.pop,
        zIndex: 100,
        ...style,
      }}
    >
      {verbs.map((verbId) => {
        const verb = verbById(verbId);
        if (!verb) return null;
        const capable = capabilities[verbId] !== false;
        const dimmed = dimmedVerb === verbId;
        return <Row key={verbId} verb={verb} disabled={!capable} dimmed={dimmed} onPick={onPick} />;
      })}
    </div>
  );
}

function Row({
  verb,
  disabled,
  dimmed,
  onPick,
}: {
  verb: VerbSpec;
  disabled: boolean;
  dimmed: boolean;
  onPick: (id: VerbId) => void;
}) {
  return (
    <>
      {verb.separator === true && (
        <div
          aria-hidden="true"
          style={{
            height: 1,
            background: color.line,
            margin: '6px 0',
          }}
        />
      )}
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        onClick={() => onPick(verb.id)}
        style={{
          display: 'grid',
          gridTemplateColumns: '20px 1fr auto',
          gap: 10,
          alignItems: 'center',
          width: '100%',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: radius.sm,
          fontFamily: font.sans,
          fontSize: 13,
          fontWeight: 500,
          color: disabled ? color.fgMuted : TONE_TO_FG[verb.tone],
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: dimmed ? 0.55 : disabled ? 0.5 : 1,
          textAlign: 'left',
          transition: 'background 100ms',
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = color.mutedBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        onFocus={(e) => {
          if (!disabled) e.currentTarget.style.background = color.mutedBg;
        }}
        onBlur={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <Icon glyph={verb.icon} />
        <span>{verb.label}</span>
        <Kbd shortcut={verb.shortcut} />
      </button>
    </>
  );
}

function Icon({ glyph }: { glyph: string | undefined }) {
  if (glyph === undefined) {
    return <span style={{ width: 20 }} />;
  }
  return (
    <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>
      {glyph}
    </span>
  );
}

function Kbd({ shortcut }: { shortcut: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        color: color.fgMuted,
        background: color.mutedBg,
        padding: '2px 6px',
        borderRadius: radius.sm,
        letterSpacing: '0.04em',
      }}
    >
      ⌨ {shortcut}
    </span>
  );
}

interface ActionPopoverTriggerProps {
  onClick: () => void;
  /** Override label/title for accessibility. Default: "More actions". */
  ariaLabel?: string;
  /** Optional style overrides for positioning. */
  style?: CSSProperties;
  /** Optional child content; defaults to the `⋯` glyph. */
  children?: ReactNode;
}

/**
 * `<ActionPopoverTrigger>` — the `⋯` button affordance that opens
 * the popover. Shipped here so every consumer renders it with the
 * same tone + size; the consumer wires the open/close state.
 */
export function ActionPopoverTrigger({
  onClick,
  ariaLabel = 'More actions',
  style,
  children = '⋯',
}: ActionPopoverTriggerProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${color.line}`,
        borderRadius: radius.sm,
        padding: '6px 9px',
        fontFamily: font.sans,
        fontSize: 14,
        color: color.fgMuted,
        cursor: 'pointer',
        lineHeight: 1,
        transition: 'border-color 100ms, color 100ms',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
