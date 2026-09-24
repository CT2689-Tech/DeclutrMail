import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSenderPane } from './use-sender-pane';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/senders',
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
beforeEach(() => {
  window.history.replaceState(null, '', '/senders?q=bank&sort=name#list');
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe('sender pane navigation', () => {
  it('opens, switches and closes without a server navigation, preserving scope and one Back entry', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const { result, rerender } = renderHook(() => useSenderPane());
    act(() => result.current.open('a'));
    expect(new URLSearchParams(window.location.search).get('sender')).toBe('a');
    expect(push).toHaveBeenCalledTimes(1);
    // A second selection before React renders must replace the same entry.
    act(() => result.current.open('b'));
    rerender();
    expect(result.current.senderId).toBe('b');
    expect(push).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    act(() => result.current.close());
    rerender();
    expect(result.current.senderId).toBeNull();
    expect(window.location.search).toBe('?q=bank&sort=name');
    expect(window.location.hash).toBe('#list');
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reads restored history and still routes full-page navigation', () => {
    const { result, rerender } = renderHook(() => useSenderPane());
    window.history.replaceState(null, '', '/senders?sender=restored');
    rerender();
    expect(result.current.senderId).toBe('restored');
    act(() => result.current.navigateTo('restored', 'replace'));
    expect(router.replace).toHaveBeenCalledWith('/senders/restored');
  });
});
