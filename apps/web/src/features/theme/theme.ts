/**
 * Theme preference plumbing (dark mode).
 *
 * Resolution order: localStorage `dm-theme` ('light' | 'dark') →
 * OS `prefers-color-scheme`. The resolved value lands as
 * `data-theme` on <html>; every color token is a CSS custom
 * property keyed off that attribute (packages/shared/styles/
 * tokens.css), so the swap needs no React re-render.
 *
 * The pre-paint resolver is a STATIC asset (apps/web/public/
 * theme-init.js, nonced per D175) because CSP forbids inline
 * markup injection here. It duplicates the storage key + fallback
 * rule — keep the two in sync.
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'dm-theme';

/** Read the resolved theme off <html> (set by the bootstrap script). */
export function getResolvedTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Apply + persist an explicit preference. */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable (private mode / quota) — the attribute still
    // applied, so the choice holds for this page lifetime.
  }
}
