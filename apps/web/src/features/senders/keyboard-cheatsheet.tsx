'use client';

import { useEffect, useState } from 'react';
import { Kbd, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import {
  CANONICAL_SHORTCUTS,
  getActionDescriptor,
  type ActionVerb,
} from '@declutrmail/shared/actions';

import { isTypingTarget } from './keyboard';

const { color, font, radius, shadow, text } = tokens;

/**
 * Keyboard cheatsheet (§3.1) — the premium-app pattern: shortcuts stay
 * INVISIBLE inline and are revealed only on demand via `?`. The verb rows
 * are derived from the Action Registry (ADR-0015), so the four canonical
 * K/A/U/L bindings (D227) can never drift from the descriptors the action
 * surfaces render.
 *
 * Self-contained: it owns its own `?` toggle + Escape close, guarded so a
 * `?` typed into a search field never pops the overlay. Mount once per
 * screen that exposes the shortcuts.
 */

/**
 * The four canonical verbs, in D227 K/A/U/L order — derived from
 * `CANONICAL_SHORTCUTS` (whose insertion order IS K/A/U/L) so there is no
 * parallel hand-maintained list to drift.
 */
const CANONICAL_VERBS = Object.keys(CANONICAL_SHORTCUTS) as ActionVerb[];

export function KeyboardCheatsheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      // `?` is Shift+/ — ignore other modifiers and text-entry focus so it
      // never hijacks a typed question mark.
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        // Don't stack the cheatsheet over another modal (e.g. the mandatory
        // action preview). When already open, `?` still closes it — the
        // guard only blocks OPENING on top of an existing aria-modal dialog.
        if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return <CheatsheetPanel onClose={() => setOpen(false)} />;
}

/**
 * The cheatsheet overlay itself — presentational, always rendered. Split
 * from the stateful `KeyboardCheatsheet` wrapper so Storybook can show the
 * open state (the wrapper renders null until `?`).
 */
export function CheatsheetPanel({ onClose }: { onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div
      className="dm-scrim dm-sheet-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-cheatsheet-title"
        className="dm-sheet dm-sheet-panel"
        style={{
          width: '100%',
          maxWidth: 460,
          boxSizing: 'border-box',
          padding: '28px 28px 20px',
          background: color.card,
          boxShadow: shadow.modal,
          fontFamily: font.sans,
          color: color.fg,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 4,
          }}
        >
          <h2
            id="dm-cheatsheet-title"
            style={{ fontSize: text.xl, fontWeight: 650, letterSpacing: '-0.02em', margin: 0 }}
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = color.fill;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            style={{
              width: 36,
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: radius.pill,
              color: color.fgMuted,
              cursor: 'pointer',
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div>
          <SectionLabel>Selected senders</SectionLabel>
          {CANONICAL_VERBS.map((verb) => {
            const { copy, shortcut } = getActionDescriptor(verb);
            return <ShortcutRow key={verb} keys={shortcut ?? '—'} label={copy.primary} />;
          })}

          <SectionLabel>Sender list</SectionLabel>
          <ShortcutRow keys="J / ↓" label="Next sender" />
          <ShortcutRow keys="K / ↑" label="Previous sender" />
          <ShortcutRow keys="Esc" label="Close sender details" />

          <SectionLabel>In a preview</SectionLabel>
          <ShortcutRow keys="⌘⏎" label="Confirm the action" />
          <ShortcutRow keys="Esc" label="Cancel / close" />
          <ShortcutRow keys="?" label="Toggle this cheatsheet" />
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: text.sm,
        fontWeight: 600,
        color: color.fgMuted,
        margin: '20px 0 4px',
      }}
    >
      {children}
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        minHeight: 40,
      }}
    >
      <span style={{ fontSize: text.md, color: color.fg }}>{label}</span>
      <Kbd>{keys}</Kbd>
    </div>
  );
}
