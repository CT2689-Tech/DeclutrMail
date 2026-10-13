'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { UNDO_TRAY_INSET_VAR } from './undo-tray/undo-tray';
import { OVERLAY_Z, bottomClearOfCookieBanner } from '../tokens/overlay-layers';
import { color, font, radius, shadow, text } from '../tokens/tokens';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: string;
  msg: string;
  tone: ToastTone;
  action?: ToastAction;
}

/**
 * Module-level toast bus. Any code can call `toast(...)`; a single
 * `<ToastHost />` mounted at the app root renders the stack. This keeps
 * call sites free of prop-drilling without reaching for `window`.
 */
let queue: ToastItem[] = [];
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(queue);
}

/** Return an idempotent dismiss callback for notifications tied to a pending request. */
export function toast(msg: string, tone: ToastTone = 'info', action?: ToastAction): () => void {
  const id = Math.random().toString(36).slice(2);
  queue = [...queue, { id, msg, tone, ...(action == null ? {} : { action }) }];
  emit();
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    queue = queue.filter((t) => t.id !== id);
    emit();
  };
  const timer = setTimeout(dismiss, 3600);
  return dismiss;
}

// Every toast is the same inverse surface (fg ink: near-black on light,
// light on dark); the tone rides as a small dot, never a coloured slab.
const TONE_DOT: Record<ToastTone, string | null> = {
  info: null,
  success: color.emerald,
  warn: color.amber,
  danger: color.red,
};

/** Fixed stack: above the undo tray when it publishes, otherwise above the cookie banner. */
export function toastStackPosition(): CSSProperties {
  return {
    position: 'fixed',
    // The tray inset is measured from the tray's real top, so it already
    // includes a cookie-banner lift. With no tray, clear the banner directly.
    bottom: `var(${UNDO_TRAY_INSET_VAR}, ${bottomClearOfCookieBanner('20px + var(--dm-tabbar-inset, 0px)')})`,
    maxWidth: 'calc(100vw - 32px)',
    width: 'max-content',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: OVERLAY_Z.toast,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: 'none',
  };
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const listener = (next: ToastItem[]) => setItems([...next]);
    listeners.add(listener);
    listener(queue);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!mounted || items.length === 0) return null;

  return createPortal(
    <div style={toastStackPosition()}>
      {items.map((t) => (
        <ToastAnnouncement
          key={t.id}
          msg={t.msg}
          tone={t.tone}
          {...(t.action == null ? {} : { action: t.action })}
        />
      ))}
    </div>,
    document.body,
  );
}

/**
 * One independently announced toast. Informational and successful
 * updates do not interrupt the user's current task; warnings and
 * failures are announced immediately because they may require action.
 *
 * Exported from this module (but not the package barrel) so the ARIA
 * contract can be tested without mounting the module-level toast bus.
 */
export function ToastAnnouncement({
  msg,
  tone,
  action,
}: {
  msg: string;
  tone: ToastTone;
  action?: ToastAction;
}) {
  const assertive = tone === 'warn' || tone === 'danger';

  return (
    <div
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 18px',
        background: color.fg,
        color: color.fgInverse,
        borderRadius: radius.lg,
        fontFamily: font.sans,
        fontSize: text.base,
        fontWeight: 500,
        boxShadow: shadow.pop,
        pointerEvents: 'auto',
        animation: 'dm-toast-in 0.22s cubic-bezier(0.2,0.7,0.3,1)',
      }}
    >
      {TONE_DOT[tone] !== null && (
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            flex: '0 0 auto',
            borderRadius: radius.pill,
            background: TONE_DOT[tone],
          }}
        />
      )}
      <span>{msg}</span>
      {action == null ? null : (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginLeft: 8,
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
