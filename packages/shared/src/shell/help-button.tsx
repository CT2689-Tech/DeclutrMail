'use client';

import { useEffect, useState } from 'react';

import { useFocusTrap } from '../hooks/use-focus-trap';
import { useUiStore } from '../state/ui-store';
import { color, font, motion, radius, shadow, text } from '../tokens/tokens';

/**
 * Top-bar `?` — the one place a screen's "what is this" help lives.
 * Content comes from whichever `<ScreenIntro>` is mounted (ui-store
 * `screenHelp`); with nothing registered the button is not rendered, so
 * it never opens onto an empty panel.
 */
export function HelpButton() {
  // Closed, the button only needs to know whether help exists — a screen
  // re-registers its help on every commit, and subscribing to the whole
  // entry would re-render the top bar each time.
  const hasHelp = useUiStore((s) => s.screenHelp !== null);
  const [open, setOpen] = useState(false);

  // The owning screen unmounted (route change) while the panel was open.
  useEffect(() => {
    if (!hasHelp) setOpen(false);
  }, [hasHelp]);

  if (!hasHelp) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="dm-nav-row dm-topbar-icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="About this screen"
        aria-haspopup="dialog"
        aria-expanded={open}
        style={{
          // Size comes from `.dm-topbar-icon` (32px, 44px on touch widths).
          padding: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: radius.pill,
          color: color.fgMuted,
          fontFamily: font.sans,
          fontSize: text.md,
          fontWeight: 600,
          cursor: 'pointer',
          transition: `background ${motion.fast} ${motion.ease}`,
        }}
      >
        ?
      </button>
      {open && <HelpPopover onClose={() => setOpen(false)} />}
    </div>
  );
}

function HelpPopover({ onClose }: { onClose: () => void }) {
  const help = useUiStore((s) => s.screenHelp);
  // Focus moves into the panel and returns to the `?` on close.
  const panelRef = useFocusTrap<HTMLDivElement>(true, {
    initialFocusSelector: '[data-focus-initial]',
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    const onPointer = (event: MouseEvent) => {
      const panel = panelRef.current;
      // The `?` toggles itself; treating its click as "outside" would
      // close and immediately reopen.
      if (panel && !panel.parentElement?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onClose, panelRef]);

  if (help === null) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`About ${help.title}`}
      style={{
        position: 'absolute',
        top: 40,
        right: 0,
        zIndex: 90,
        width: 320,
        maxWidth: 'calc(100vw - 24px)',
        boxSizing: 'border-box',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        background: color.card,
        borderRadius: radius.lg,
        boxShadow: shadow.pop,
        fontFamily: font.sans,
        color: color.fg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ flex: 1, margin: 0, fontSize: text.lg, fontWeight: 600 }}>{help.title}</h2>
        <button
          type="button"
          data-focus-initial
          onClick={onClose}
          aria-label="Close help"
          className="dm-nav-row dm-topbar-icon"
          style={{
            flexShrink: 0,
            padding: 0,
            border: 'none',
            borderRadius: radius.pill,
            color: color.fgMuted,
            fontSize: text.lg,
            lineHeight: 1,
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ fontSize: text.md, lineHeight: 1.5 }}>{help.body}</div>
      {help.tip != null && (
        <div style={{ fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>{help.tip}</div>
      )}
      {help.learnMore != null && (
        <a
          href={help.learnMore.href}
          style={{
            alignSelf: 'flex-start',
            fontSize: text.sm,
            fontWeight: 600,
            color: color.primary,
            textDecoration: 'none',
          }}
        >
          {help.learnMore.label} →
        </a>
      )}
    </div>
  );
}
