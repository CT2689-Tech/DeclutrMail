/**
 * `next/navigation` for tests that need the page URL to behave like it
 * does under the App Router: `useSearchParams` re-renders on
 * `history.pushState` / `replaceState` / Back, as Next's native-history
 * integration does.
 *
 *   vi.mock('next/navigation', async () =>
 *     (await import('@/test/next-navigation-url')).nextNavigationUrlMock());
 */
import { useMemo, useSyncExternalStore } from 'react';
import { vi } from 'vitest';

const listeners = new Set<() => void>();
let patched = false;

function patchHistory(): void {
  if (patched) return;
  patched = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History['pushState']>) => {
      original(...args);
      listeners.forEach((notify) => notify());
    };
  }
  window.addEventListener('popstate', () => listeners.forEach((notify) => notify()));
}

export const testRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
  refresh: vi.fn(),
};

export function nextNavigationUrlMock() {
  patchHistory();
  return {
    useRouter: () => testRouter,
    usePathname: () => window.location.pathname,
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (notify) => {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
        () => window.location.search,
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
}
