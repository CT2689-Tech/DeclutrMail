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
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'var(--dm-scrim)',
          zIndex: 200,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-cheatsheet-title"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(440px, calc(100vw - 32px))',
          maxHeight: '72vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: radius.lg,
          boxShadow: shadow.pop,
          zIndex: 201,
          fontFamily: font.sans,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px 12px',
            borderBottom: `1px solid ${color.line}`,
          }}
        >
          <h2 id="dm-cheatsheet-title" style={{ fontSize: text.lg, fontWeight: 600, margin: 0 }}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close shortcuts"
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              color: color.fgMuted,
              fontSize: text.lg,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '8px 20px 16px' }}>
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
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: text.xs,
        color: color.fgMuted,
        margin: '14px 0 6px',
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
        padding: '7px 0',
        borderBottom: `1px solid ${color.lineSoft}`,
      }}
    >
      <span style={{ fontSize: text.base, color: color.fg }}>{label}</span>
      <Kbd>{keys}</Kbd>
    </div>
  );
}
