'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'summary,a[href],button:not([disabled]):not([tabindex="-1"]),input:not([disabled]):not([tabindex="-1"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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
  options?: { initialFocusSelector?: string; returnFocusRef?: RefObject<HTMLElement | null> },
) {
  const ref = useRef<T>(null);
  const initialFocusSelector = options?.initialFocusSelector;
  const returnFocusRef = options?.returnFocusRef;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    // An async/lazy host can mount after the opener lost focus. Its
    // persistent trigger is the explicit return point when supplied.
    const restoreTo = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
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
    let addedTabIndex = false;
    const focusPanel = () => {
      if (!node.hasAttribute('tabindex')) {
        node.tabIndex = -1;
        addedTabIndex = true;
      }
      node.focus();
    };
    const initialItems = focusable();
    const initialTarget =
      preferred && initialItems.includes(preferred) ? preferred : initialItems[0];
    if (initialTarget) initialTarget.focus();
    else focusPanel();

    // Disabling the last control can return focus to the page. Keep a
    // busy dialog focused without taking focus from another open surface.
    const observer = new MutationObserver(() => {
      if (
        focusable().length === 0 &&
        (document.activeElement === document.body || node.contains(document.activeElement))
      ) {
        focusPanel();
      }
    });
    observer.observe(node, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'open', 'tabindex'],
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        focusPanel();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!items.includes(document.activeElement as HTMLElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
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
      observer.disconnect();
      if (addedTabIndex) node.removeAttribute('tabindex');
      restoreTo?.focus?.();
    };
  }, [active, initialFocusSelector, returnFocusRef]);

  return ref;
}
