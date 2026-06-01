/** Shared keyboard helpers for the senders surface. */

/**
 * True when focus sits in a text-entry surface — a printable key like `?`
 * or a verb letter is a literal there, not a shortcut. Shared by the
 * cheatsheet's `?` toggle and the screen's K/A/U/L handler so both guard
 * identically.
 */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}
