import { beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreSendersLayout, SENDERS_LAYOUT_STORAGE_KEY, useSendersStore } from './store';

/**
 * Founder report 2026-09-20: the table layout fell back to grid after a
 * refresh or a back/forward load. The layout is a per-device preference,
 * so it survives a full page load (overrides D49's session-only toggle).
 */
describe('senders store — layout preference survives a page load', () => {
  beforeEach(() => {
    localStorage.clear();
    useSendersStore.setState({ view: 'grid', density: 'comfortable' });
  });

  it('writes the chosen layout and density to this device', () => {
    useSendersStore.getState().setView('table');
    useSendersStore.getState().setDensity('compact');
    const stored = JSON.parse(localStorage.getItem(SENDERS_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(stored).toEqual({ view: 'table', density: 'compact' });
  });

  it('restores the stored layout — what a fresh page load does', () => {
    localStorage.setItem(
      SENDERS_LAYOUT_STORAGE_KEY,
      JSON.stringify({ view: 'table', density: 'compact' }),
    );
    restoreSendersLayout();
    expect(useSendersStore.getState().view).toBe('table');
    expect(useSendersStore.getState().density).toBe('compact');
  });

  it('never persists the sort — a stale sort would silently reorder the list', () => {
    useSendersStore.getState().setSort({ sort: 'total', direction: 'asc' });
    useSendersStore.getState().setView('table');
    const stored = JSON.parse(localStorage.getItem(SENDERS_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(Object.keys(stored).sort()).toEqual(['density', 'view']);
  });

  it('ignores an unknown stored value and keeps the grid default', () => {
    localStorage.setItem(
      SENDERS_LAYOUT_STORAGE_KEY,
      JSON.stringify({ view: 'kanban', density: 7 }),
    );
    restoreSendersLayout();
    expect(useSendersStore.getState().view).toBe('grid');
    expect(useSendersStore.getState().density).toBe('comfortable');
  });

  it('survives unparseable storage and storage that throws', () => {
    localStorage.setItem(SENDERS_LAYOUT_STORAGE_KEY, '{not json');
    expect(() => restoreSendersLayout()).not.toThrow();
    expect(useSendersStore.getState().view).toBe('grid');

    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => useSendersStore.getState().setView('table')).not.toThrow();
    // Not remembered, but the choice still applies for this visit.
    expect(useSendersStore.getState().view).toBe('table');
    spy.mockRestore();
  });
});
