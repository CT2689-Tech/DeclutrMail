import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_COMPOSE } from './compose-strip';
import { useComposeState } from './use-compose-state';
import { useSendersStore } from './store';

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/senders',
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.params,
}));

function lastReplacement(): URL {
  const href = navigation.replace.mock.calls.at(-1)?.[0];
  expect(typeof href).toBe('string');
  return new URL(href as string, 'https://declutr.test');
}

describe('useComposeState — shareable Senders scope', () => {
  beforeEach(() => {
    navigation.params = new URLSearchParams();
    navigation.replace.mockReset();
    useSendersStore.setState({ sort: 'total', direction: 'desc' });
  });

  it('restores search, temporary filters, and sorting from the URL', () => {
    navigation.params = new URLSearchParams(
      'q=renewals&activity=not-quiet&replied=true&domain=example.com&sort=name&direction=asc',
    );

    const { result } = renderHook(() => useComposeState());

    expect(result.current.query).toBe('renewals');
    expect(result.current.compose).toMatchObject({
      activity: 'quiet',
      activityNegate: true,
      replied: true,
      domain: 'example.com',
    });
    expect(result.current.sort).toBe('name');
    expect(result.current.direction).toBe('asc');
    expect(useSendersStore.getState()).toMatchObject({ sort: 'name', direction: 'asc' });
  });

  it('keeps the complete scope when search and sort change in quick succession', () => {
    navigation.params = new URLSearchParams('activity=dormant&ref=brief');
    const { result } = renderHook(() => useComposeState());

    act(() => result.current.setQuery('  billing  '));
    act(() => result.current.setSort({ sort: 'name', direction: 'asc' }));

    const url = lastReplacement();
    expect(url.searchParams.get('q')).toBe('billing');
    expect(url.searchParams.get('activity')).toBe('dormant');
    expect(url.searchParams.get('sort')).toBe('name');
    expect(url.searchParams.get('direction')).toBe('asc');
    expect(url.searchParams.get('ref')).toBe('brief');
  });

  it('preserves table-only sorts in the shareable URL', () => {
    navigation.params = new URLSearchParams('sort=read&direction=desc');
    const { result } = renderHook(() => useComposeState());

    expect(result.current.sort).toBe('read');

    act(() => result.current.setSort({ sort: 'recommended', direction: 'desc' }));

    const url = lastReplacement();
    expect(url.searchParams.get('sort')).toBe('recommended');
    expect(result.current.sort).toBe('recommended');
  });

  it('applies a saved view atomically and clears the transient search', () => {
    navigation.params = new URLSearchParams(
      'q=hidden-query&activity=active&sort=first_seen&direction=desc',
    );
    const { result } = renderHook(() => useComposeState());

    act(() =>
      result.current.applySavedScope({
        compose: { ...EMPTY_COMPOSE, protectedFlag: true, windowDays: 90 },
        sort: 'name',
        direction: 'asc',
      }),
    );

    const url = lastReplacement();
    expect(result.current.query).toBe('');
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('activity')).toBe(false);
    expect(url.searchParams.get('protected')).toBe('true');
    expect(url.searchParams.get('window')).toBe('90');
    expect(url.searchParams.get('sort')).toBe('name');
    expect(url.searchParams.get('direction')).toBe('asc');
  });

  it('responds to browser history changes and keeps zero-result recovery atomic', async () => {
    navigation.params = new URLSearchParams('q=first&activity=quiet');
    const { result, rerender } = renderHook(() => useComposeState());

    navigation.params = new URLSearchParams('q=second&protected=true&sort=name&direction=asc');
    rerender();

    await waitFor(() => expect(result.current.query).toBe('second'));
    expect(result.current.compose.protectedFlag).toBe(true);
    expect(result.current.sort).toBe('name');

    act(() => result.current.clearSearchAndFilters());
    const url = lastReplacement();
    expect(url.searchParams.has('q')).toBe(false);
    expect(url.searchParams.has('protected')).toBe(false);
    expect(url.searchParams.get('sort')).toBe('name');
    expect(url.searchParams.get('direction')).toBe('asc');
  });
});
