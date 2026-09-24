'use client';

import { useEffect, useState } from 'react';
import { Kbd, tokens } from '@declutrmail/shared';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
// Cross-feature helper import per ADR-0007's second-consumer rule —
// the senders cheatsheet and this overlay must guard `?` identically
// (a `?` typed into a search field is a literal, never a toggle).
import { isTypingTarget } from '@/features/senders/keyboard';

import { VERB_ORDER, VERB_SHORTCUT } from './types';

const { color, font, radius, shadow, text } = tokens;

/**
 * Triage keyboard-hint overlay — press `?` to reveal, Escape (or the
 * close button / backdrop) to dismiss. Mirrors the senders
 * `KeyboardCheatsheet` pattern: shortcuts stay invisible inline and
 * are revealed only on demand.
 *
 * Every row documents a REAL binding wired in this feature — nothing
 * aspirational:
 *
 *   - K/A/U/L/D    → `resolveShortcut` in `action-toolbar.tsx` (bound
 *                     for the focus card, or the expanded list row;
 *                     D29 + D227)
 *   - →            → skip to the next sender (`focus-stack.tsx`)
 *   - Enter/Space  → list row expand/collapse (`triage-row.tsx`)
 *   - → ← ↑ swipes → Keep / Archive / Later on touch (`use-swipe-verb.ts`)
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
  Keep: 'Keep this sender',
  Archive: 'Archive this sender',
  Unsubscribe: 'Unsubscribe from this sender',
  Later: 'Move this sender to Later',
  Delete: 'Move this sender’s inbox email to Gmail Trash',
};

/**
 * The overlay itself — presentational, always rendered. Split from the
 * stateful wrapper so Storybook shows the open state (the wrapper
 * renders null until `?`).
 */
export function TriageKeyboardHelpPanel({ onClose }: { onClose: () => void }) {
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
        aria-labelledby="dm-triage-help-title"
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
            id="dm-triage-help-title"
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
          <SectionLabel>Decide</SectionLabel>
          {VERB_ORDER.map((verb) => (
            <ShortcutRow key={verb} keys={VERB_SHORTCUT[verb]} label={VERB_HELP[verb]} />
          ))}

          <SectionLabel>Navigate</SectionLabel>
          <ShortcutRow keys="→" label="Skip to the next sender" />
          <ShortcutRow keys="Enter / Space" label="Open or close a list row" />
          <ShortcutRow keys="Z" label="Undo the last decision" />

          <SectionLabel>In a preview</SectionLabel>
          <ShortcutRow keys="⌘⏎" label="Confirm the preview" />
          <ShortcutRow keys="Esc" label="Cancel the sheet / dismiss an inline preview" />
          <ShortcutRow keys="?" label="Toggle this overlay" />

          {/* D37 — gestures are invisible without a legend; it lives
              here rather than as a caption on every card. */}
          <SectionLabel>On touch</SectionLabel>
          <ShortcutRow keys="Swipe →" label="Keep" />
          <ShortcutRow keys="Swipe ←" label="Archive" />
          <ShortcutRow keys="Swipe ↑" label="Later" />
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
