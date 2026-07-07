'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { color, font, radius, shadow } from '../tokens/tokens';

export type ToastTone = 'info' | 'success' | 'warn' | 'danger';

interface ToastItem {
  id: string;
  msg: string;
  tone: ToastTone;
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

export function toast(msg: string, tone: ToastTone = 'info'): void {
  const id = Math.random().toString(36).slice(2);
  queue = [...queue, { id, msg, tone }];
  emit();
  setTimeout(() => {
    queue = queue.filter((t) => t.id !== id);
    emit();
  }, 3600);
}

const TONE_BG: Record<ToastTone, string> = {
  // Ink chip — was the literal '#1F2826'; the fg token keeps the same
  // near-black chip on light and flips to a light chip on dark, so the
  // fgInverse text below stays readable in both themes.
  info: color.fg,
  success: color.emerald,
  warn: color.amber,
  danger: color.red,
};

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
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 16px',
            background: TONE_BG[t.tone],
            color: color.fgInverse,
            borderRadius: radius.pill,
            fontFamily: font.sans,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: shadow.pop,
            pointerEvents: 'auto',
            animation: 'dm-toast-in 0.22s cubic-bezier(0.2,0.7,0.3,1)',
          }}
        >
          {t.msg}
        </div>
      ))}
    </div>,
    document.body,
  );
}
