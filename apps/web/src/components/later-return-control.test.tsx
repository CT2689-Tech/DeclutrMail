import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFutureReturnTime } from './later-return-control';

describe('Later confirmation clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T18:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('rearms when the user edits the return, then expires without another edit', () => {
    const { result, rerender } = renderHook(({ value }) => useFutureReturnTime(value, true), {
      initialProps: { value: new Date(Date.now() + 1_000).toISOString() },
    });
    expect(result.current.valid).toBe(true);
    rerender({ value: new Date(Date.now() + 2_000).toISOString() });
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.valid).toBe(true);
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.valid).toBe(false);
  });

  it('rechecks a backgrounded tab after the wall clock jumps past its return', () => {
    const { result } = renderHook(() =>
      useFutureReturnTime(new Date('2026-10-20T18:01:00Z').toISOString(), true),
    );
    expect(result.current.valid).toBe(true);
    vi.setSystemTime(new Date('2026-10-20T18:02:00Z'));
    fireEvent.focus(window);
    expect(result.current.valid).toBe(false);
  });

  it('handles a return beyond the native timeout limit without immediately expiring', () => {
    const value = new Date(Date.now() + 2_147_483_647 + 100).toISOString();
    const { result } = renderHook(() => useFutureReturnTime(value, true));
    act(() => vi.advanceTimersByTime(2_147_483_647));
    expect(result.current.valid).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.valid).toBe(false);
  });

  it('cancels its timer when the preview closes or unmounts', () => {
    const value = new Date(Date.now() + 1_000).toISOString();
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useFutureReturnTime(value, enabled),
      { initialProps: { enabled: true } },
    );
    expect(vi.getTimerCount()).toBe(1);
    rerender({ enabled: false });
    expect(result.current.valid).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    rerender({ enabled: true });
    expect(result.current.valid).toBe(true);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, '', 'invalid', '2026-10-20T17:59:00Z'])(
    'keeps an invalid or cleared return closed: %s',
    (value) => {
      const { result } = renderHook(() => useFutureReturnTime(value, true));
      expect(result.current.valid).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});
