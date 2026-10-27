import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CleanupImpact } from './cleanup-preview';
import type { DeleteEmptyContext } from './delete-empty-state';

function show(
  context: DeleteEmptyContext,
  age: number | null = null,
  archived = false,
  count: number | null = 0,
) {
  return render(
    <CleanupImpact
      action="Delete"
      count={count}
      olderThanDays={age}
      includesArchived={archived}
      emptyContext={context}
      note="Undo from Activity for 30 days."
    />,
  );
}

describe('empty Delete reason and next action', () => {
  it.each([false, true])(
    'only calls current mail empty when both fresh totals prove it (archived=%s)',
    (archived) => {
      show({ inboxTotal: 0, allMailTotal: 0 }, 180, archived);
      expect(screen.getByText('No current Inbox or archived email to delete.')).toBeVisible();
      expect(screen.getByText('Cancel to choose another action.')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Use Any age' })).toBeNull();
      expect(screen.queryByText(/Undo/)).toBeNull();
    },
  );
  it('offers future-only Unsubscribe without submitting it', () => {
    const onUnsubscribeOnly = vi.fn();
    show({ inboxTotal: 0, allMailTotal: 0, onUnsubscribeOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Choose Unsubscribe only' }));
    expect(onUnsubscribeOnly).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    'explains an age exclusion in the selected scope (archived=%s)',
    (archived) => {
      const onAnyAge = vi.fn();
      show({ inboxTotal: 2, allMailTotal: 5, onAnyAge }, 180, archived);
      expect(screen.getByText('The age filter excludes these emails.')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Use Any age' }));
      expect(onAnyAge).toHaveBeenCalledOnce();
      expect(screen.queryByText('No current Inbox or archived email to delete.')).toBeNull();
    },
  );
  it('explains archived-only mail and offers the matching reach', () => {
    const onIncludeArchived = vi.fn();
    show({ inboxTotal: 0, allMailTotal: 5, allMailWindowCount: 2, onIncludeArchived }, 180);
    expect(screen.getByText('Archived email isn’t included.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Include archived' }));
    expect(onIncludeArchived).toHaveBeenCalledOnce();
  });
  it('widens both filters when neither alone reaches known archived mail', () => {
    const onAnyAge = vi.fn();
    const onIncludeArchived = vi.fn();
    show(
      { inboxTotal: 0, allMailTotal: 5, allMailWindowCount: 0, onAnyAge, onIncludeArchived },
      180,
    );
    expect(screen.getByText('The filters exclude these emails.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Show all email' }));
    expect(onAnyAge).toHaveBeenCalledOnce();
    expect(onIncludeArchived).toHaveBeenCalledOnce();
  });
  it.each([{}, { inboxTotal: 0 }, { inboxTotal: null, allMailTotal: null }])(
    'does not turn unknown totals into no-mail claims: %j',
    (context) => {
      show({ ...context, onAnyAge: vi.fn() }, 180);
      expect(screen.getByText('No emails match these choices.')).toBeVisible();
      expect(screen.getByText('Change the filters or cancel this preview.')).toBeVisible();
      expect(screen.queryByText('No current Inbox or archived email to delete.')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
    },
  );
  it('scopes a partially excluded bulk selection truthfully', () => {
    show({ inboxTotal: 0, allMailTotal: 0, excludedSenders: true });
    expect(screen.getByText('No Inbox or archived email from included senders.')).toBeVisible();
    expect(screen.queryByText('No current Inbox or archived email to delete.')).toBeNull();
  });
  it('puts eligibility before empty counts and filter advice', () => {
    show({ inboxTotal: 0, allMailTotal: 0, noIncludedSenders: true });
    expect(screen.getByText('No senders included.')).toBeVisible();
    expect(screen.getByText('Cancel to change your selection.')).toBeVisible();
  });
  it.each([null, 2])('does not show empty guidance before a zero is established: %s', (count) => {
    show({ inboxTotal: 0, allMailTotal: 0 }, null, false, count);
    expect(screen.queryByText('No current Inbox or archived email to delete.')).toBeNull();
    expect(screen.queryByText('Cancel to choose another action.')).toBeNull();
  });
});
