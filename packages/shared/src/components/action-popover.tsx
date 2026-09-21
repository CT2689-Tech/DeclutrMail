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
//   - apps/web/src/features/senders/action-row.tsx (SenderActionRow),
//     itself rendered by grid/sender-card.tsx, sender-table/sender-
//     table.tsx, and table/sender-list-row.tsx. Positions itself
//     absolutely, so every call site needs a `position: relative`
//     ancestor around the trigger — see `ActionPopoverProps.style`.

'use client';

import { useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  VERB_REGISTRY,
  verbById,
  type VerbId,
  type VerbSpec,
  type VerbTone,
} from '../actions/verb-registry';
import { tokens } from '../tokens/tokens';
import { useFocusTrap } from '../hooks/use-focus-trap';
import { Kbd as KeyChip } from './kbd';

const { color, font, motion, radius, shadow } = tokens;

// Fade + scale from the trigger corner (the menu opens above, right-aligned).
const MENU_CSS = `
@keyframes dm-action-menu-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}
.dm-action-menu{transform-origin:bottom right;animation:dm-action-menu-in ${motion.fast} ${motion.ease}}
`;

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
   * Contextual aria-label for the popover container, such as
   * "Actions for Acme Deals" or "Bulk actions for 4 selected senders".
   * Required so repeated sender menus never share a generic name.
   */
  ariaLabel: string;

  /**
   * Optional style overrides. The component positions itself
   * (`position: absolute; bottom: calc(100% + 4px); right: 0`) so the
   * caller only needs a `position: relative` ancestor around the
   * trigger — this is for the rare override, not the normal wiring.
   * Note the automatic edge clamp (below) recomputes `left` / `right`
   * / `top` / `bottom` / `maxHeight` after mount and applies on top of
   * anything set here, so an override of those specific properties can
   * still be superseded when the popover would otherwise overflow the
   * viewport.
   */
  style?: CSSProperties;
}

/**
 * `<ActionPopover>` — render a K/A/U/L/D overflow menu.
 *
 * Self-closes on the keyboard-shortcut pick path only; the CLICK path
 * leaves closing to the consumer — call `onClose()` inside your
 * `onPick` (both `SenderActionRow` consumers do). The trigger (`⋯`
 * button) lives at each call-site; this component is purely the
 * dropdown surface. Positions itself above/right-aligned to its
 * `position: relative` offset parent by default; detects viewport
 * left/top overflow and clamps toward the offset parent's edge
 * instead (see the edge-clamp effect below for the exact mechanics).
 */
export function ActionPopover({
  verbs = VERB_REGISTRY.map((v) => v.id),
  capabilities = {},
  dimmedVerb,
  onPick,
  onClose,
  ariaLabel,
  style,
}: ActionPopoverProps) {
  const ref = useFocusTrap<HTMLDivElement>(true);

  // QA-senders-filtering-20260901-08 / design-system-agent PR #707
  // review: the same viewport-edge-clamp technique (measure the
  // rendered rect once via useLayoutEffect, clamp whichever edges
  // overflow, flip + cap maxHeight when there's no room in the default
  // direction) was implemented for compose-strip.tsx's own Popover in
  // PR #707. This shared sibling — the same K/A/U/L/D grammar rendered
  // on every SenderCard, SenderTable, and SenderListRow via
  // `action-row.tsx` — didn't have it, so a row near a viewport edge
  // still overflowed here. Ported and mirrored for this component's
  // default anchor (opens ABOVE the trigger via
  // `bottom: calc(100% + 4px)`, so the overflow-prone edge is the
  // viewport TOP, not the bottom).
  //
  // Known gap: measuring once on mount misses content that grows after
  // mount while the same popover instance stays open. This component's
  // row count is fixed per render (the Verb Registry + a static
  // capability map), so that gap doesn't bite here in practice.
  //
  // Table/card containers that clip overflow (`overflow: hidden` on
  // SenderTable's scroll body and SenderGroup) can still cut off a
  // popover the viewport itself has room for — that's a container-clip
  // problem a viewport-relative clamp can't reach, pre-existing before
  // this change, and out of scope for it.
  const [edgeFix, setEdgeFix] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fix: CSSProperties = {};
    if (rect.left < 8) {
      fix.left = 0;
      fix.right = 'auto';
    }
    if (rect.top < 8) {
      fix.bottom = 'auto';
      fix.top = 'calc(100% + 4px)';
      // Space below the trigger once flipped, measured from the
      // trigger's OWN bottom edge (the offset parent — the popover's
      // still-upward rect at this point reflects the un-flipped
      // position, one full offset-parent height above the trigger's
      // bottom edge, so deriving from the popover's own rect here would
      // over-count that height back in).
      const parentRect = el.offsetParent?.getBoundingClientRect();
      const triggerBottom = parentRect ? parentRect.bottom : rect.bottom;
      const availableBelow = window.innerHeight - triggerBottom - 4 - 8;
      fix.maxHeight = Math.max(80, availableBelow);
    }
    setEdgeFix(fix);
  }, [ref]);

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
    <>
      <style>{MENU_CSS}</style>
      <div
        ref={ref}
        role="menu"
        aria-label={ariaLabel}
        className="dm-action-menu"
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          right: 0,
          background: color.card,
          border: 'none',
          borderRadius: radius.xl,
          padding: 6,
          minWidth: 'min(220px, calc(100vw - 32px))',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          fontFamily: font.sans,
          boxShadow: shadow.pop,
          zIndex: 50,
          ...style,
          ...edgeFix,
        }}
      >
        {verbs.map((verbId) => {
          const verb = verbById(verbId);
          if (!verb) return null;
          const capable = capabilities[verbId] !== false;
          const dimmed = dimmedVerb === verbId;
          return (
            <Row key={verbId} verb={verb} disabled={!capable} dimmed={dimmed} onPick={onPick} />
          );
        })}
      </div>
    </>
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
            background: color.lineSoft,
            margin: '6px 12px',
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
          height: 40,
          padding: '0 12px',
          background: 'transparent',
          border: 'none',
          borderRadius: radius.md,
          fontFamily: font.sans,
          fontSize: tokens.text.base,
          fontWeight: 500,
          color: disabled ? color.fgMuted : TONE_TO_FG[verb.tone],
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: dimmed ? 0.55 : disabled ? 0.5 : 1,
          textAlign: 'left',
          transition: `background ${motion.fast} ${motion.ease}`,
        }}
        onMouseEnter={(e) => {
          if (!disabled) e.currentTarget.style.background = color.fill;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
        onFocus={(e) => {
          if (!disabled) e.currentTarget.style.background = color.fill;
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
    <span aria-hidden="true" style={{ fontSize: tokens.text.md, lineHeight: 1 }}>
      {glyph}
    </span>
  );
}

/** Right-aligned key hint — the shared key chip, hidden from AT. */
function Kbd({ shortcut }: { shortcut: string }) {
  return (
    <span aria-hidden="true" style={{ justifySelf: 'end', display: 'inline-flex' }}>
      <KeyChip style={{ color: color.fgMuted }}>{shortcut}</KeyChip>
    </span>
  );
}

interface ActionPopoverTriggerProps {
  onClick: () => void;
  /** Contextual label/title, such as "More actions for Acme Deals". */
  ariaLabel: string;
  /**
   * The menu cannot be opened — e.g. the row's action is still running.
   * `aria-disabled`, so the trigger stays focusable (see `Button.inert`).
   */
  disabled?: boolean;
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
  ariaLabel,
  disabled = false,
  style,
  children = '⋯',
}: ActionPopoverTriggerProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = color.fill;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
      style={{
        // A 32px ghost circle — never an outlined square.
        width: 32,
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        background: 'transparent',
        border: 'none',
        borderRadius: radius.pill,
        padding: 0,
        fontFamily: font.sans,
        fontSize: tokens.text.lg,
        fontWeight: 600,
        color: color.fgMuted,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        lineHeight: 1,
        transition: `background ${motion.fast} ${motion.ease}`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
