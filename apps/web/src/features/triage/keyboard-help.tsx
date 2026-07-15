'use client';

import { useEffect, useState } from 'react';
import { Kbd, tokens, useFocusTrap } from '@declutrmail/shared';

// Cross-feature helper import per ADR-0007's second-consumer rule —
// the senders cheatsheet and this overlay must guard `?` identically
// (a `?` typed into a search field is a literal, never a toggle).
import { isTypingTarget } from '@/features/senders/keyboard';

import { VERB_ORDER, VERB_SHORTCUT } from './types';

const { color, font } = tokens;

/**
 * Triage keyboard-hint overlay — press `?` to reveal, Escape (or the
 * close button / backdrop) to dismiss. Mirrors the senders
 * `KeyboardCheatsheet` pattern: shortcuts stay invisible inline and
 * are revealed only on demand.
 *
 * Every row documents a REAL binding wired in this feature — nothing
 * aspirational:
 *
 *   - K/A/U/L      → `resolveShortcut` in `action-toolbar.tsx` (bound
 *                     while a row is expanded; D29 + D227)
 *   - Enter/Space  → row header expand/collapse (`triage-row.tsx`)
 *   - Z            → undo last decision (`triage-undo-tray.tsx`, D35)
 *   - Esc          → close the action sheet (`action-sheet.tsx`) or
 *                     dismiss an inline preview (`triage-screen.tsx`)
 *   - ⌘⏎           → confirm inside the action sheet
 *   - ?            → this overlay
 *
 * `?` never opens on top of another modal (e.g. the D226 action
 * sheet) — same aria-modal guard as the senders cheatsheet.
 */
export function TriageKeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        return;
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        if (!open && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  return <TriageKeyboardHelpPanel onClose={() => setOpen(false)} />;
}

/** Verb → what the shortcut does, in the user's terms (D227 verbs). */
const VERB_HELP: Record<(typeof VERB_ORDER)[number], string> = {
  Keep: 'Keep the expanded sender',
  Archive: 'Archive the expanded sender',
  Unsubscribe: 'Unsubscribe from the expanded sender',
  Later: 'Move the expanded sender to Later',
};

/**
 * The overlay itself — presentational, always rendered. Split from the
 * stateful wrapper so Storybook shows the open state (the wrapper
 * renders null until `?`).
 */
export function TriageKeyboardHelpPanel({ onClose }: { onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14,20,19,0.45)',
          backdropFilter: 'blur(3px)',
          zIndex: 200,
        }}
      />
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dm-triage-help-title"
        style={{
          position: 'fixed',
          top: '14vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(440px, calc(100vw - 32px))',
          maxHeight: '72vh',
          overflow: 'auto',
          background: color.card,
          borderRadius: 14,
          border: `1px solid ${color.border}`,
          boxShadow: '0 24px 60px rgba(14,20,19,0.30)',
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
          <h2
            id="dm-triage-help-title"
            style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.012em', margin: 0 }}
          >
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
              fontSize: 16,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '8px 20px 16px' }}>
          <SectionLabel>Decide (expanded row)</SectionLabel>
          {VERB_ORDER.map((verb) => (
            <ShortcutRow key={verb} keys={VERB_SHORTCUT[verb]} label={VERB_HELP[verb]} />
          ))}

          <SectionLabel>Navigate</SectionLabel>
          <ShortcutRow keys="Enter / Space" label="Expand or collapse the focused row" />
          <ShortcutRow keys="Z" label="Undo the last decision" />

          <SectionLabel>In a preview</SectionLabel>
          <ShortcutRow keys="⌘⏎" label="Confirm the preview" />
          <ShortcutRow keys="Esc" label="Cancel the sheet / dismiss an inline preview" />
          <ShortcutRow keys="?" label="Toggle this overlay" />
        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
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
      <span style={{ fontSize: 13, color: color.fg }}>{label}</span>
      <Kbd>{keys}</Kbd>
    </div>
  );
}
