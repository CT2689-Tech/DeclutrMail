import { beforeEach, describe, expect, it } from 'vitest';

import { useSendersStore } from './store';

describe('senders store — sort', () => {
  beforeEach(() => {
    localStorage.clear();
    useSendersStore.setState({ sort: 'total', direction: 'desc' });
  });

  it('holds the chosen sort for sibling surfaces', () => {
    useSendersStore.getState().setSort({ sort: 'last_seen', direction: 'asc' });
    expect(useSendersStore.getState()).toMatchObject({ sort: 'last_seen', direction: 'asc' });
  });

  it('never persists the sort — a stale sort would silently reorder the list', () => {
    useSendersStore.getState().setSort({ sort: 'name', direction: 'asc' });
    expect(localStorage.length).toBe(0);
  });
});
