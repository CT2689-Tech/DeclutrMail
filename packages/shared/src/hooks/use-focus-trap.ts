'use client';

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'summary,a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Focus management for modal surfaces. While `active`: focus moves into
 * the returned ref's element, Tab / Shift+Tab cycle within it, and focus
 * returns to the previously-focused element when it deactivates.
 *
 * Initial focus defaults to the first focusable element in DOM order.
 * A caller whose first element is a consequential action (not a
 * dismiss/neutral default) should mark its preferred target with
 * `initialFocusSelector` — e.g. `data-focus-initial` on the safe button.
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(
  active: boolean,
  options?: { initialFocusSelector?: string },
) {
  const ref = useRef<T>(null);
  const initialFocusSelector = options?.initialFocusSelector;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
        // Descendants of a closed disclosure are in the DOM but cannot
        // receive focus. Its summary remains a keyboard control.
        for (
          let parent = element.parentElement;
          parent && parent !== node;
          parent = parent.parentElement
        ) {
          if (parent.tagName === 'DETAILS' && !parent.hasAttribute('open')) {
            const summary = parent.querySelector('summary');
            if (!summary?.contains(element)) return false;
          }
        }
        return true;
      });
    const preferred = initialFocusSelector
      ? node.querySelector<HTMLElement>(initialFocusSelector)
      : null;
    (preferred ?? focusable()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      restoreTo?.focus?.();
    };
  }, [active, initialFocusSelector]);

  return ref;
}
