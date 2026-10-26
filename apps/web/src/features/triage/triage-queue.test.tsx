// Test for TriageQueue's OWN construction of the D245 `unprotectSlot`
// (D133 inbox-simulator chunk cut, 2026-08-27).
//
// `triage-row.tsx` no longer imports `UnprotectButton` — the caller
// builds it and passes it in as a slot (see `unprotect-button.tsx`'s
// docblock). `triage-row.test.tsx` covers `TriageRow`'s placement logic
// with a HAND-BUILT slot that mirrors what this file does without ever
// calling it, so a broken wire here — e.g. `triage-queue.tsx` forgetting
// to construct `unprotectSlot`, or getting the `row.protectionReason`
// guard backwards — would render no button on every real screen (Daily
// Triage, the D245 review) and fail zero existing tests. This renders
// the REAL `TriageQueue`, not a mock.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { type TriageDecisionRow } from './data';
import { TRIAGE_QUEUE } from './fixtures';
import { resetTriageStore, useTriageStore } from './store';
import { TriageQueue, inlinePreviewFor } from './triage-queue';
import { InlinePreviewBlock } from './inline-preview';

function rowById(id: string): TriageDecisionRow {
  const r = TRIAGE_QUEUE.find((row) => row.id === id);
  if (!r) throw new Error(`fixture missing row ${id}`);
  return r;
}

beforeEach(() => resetTriageStore());

function renderQueue(rows: readonly TriageDecisionRow[], offerUnprotect: boolean) {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <TriageQueue rows={rows} onAction={() => {}} offerUnprotect={offerUnprotect} />
    </QueryWrapper>,
  );
}

describe('TriageQueue — wires the D245 row-strip Unprotect control for real', () => {
  it('renders Unprotect on a Protected row when offerUnprotect is set', () => {
    renderQueue([rowById('t-sarah')], true);
    expect(screen.getByRole('button', { name: /^Unprotect$/i })).toBeInTheDocument();
  });

  it('renders no Unprotect control for an unprotected row, even with offerUnprotect set', () => {
    renderQueue([rowById('t-groupon')], true);
    expect(screen.queryByRole('button', { name: /^Unprotect$/i })).toBeNull();
  });

  it('renders no strip on a Protected row outside the review (offerUnprotect unset)', () => {
    renderQueue([rowById('t-sarah')], false);
    expect(screen.queryByRole('button', { name: /^Unprotect$/i })).toBeNull();
  });
});

describe('the list at rest advertises no keys that do nothing', () => {
  beforeEach(() => {
    resetTriageStore();
  });

  it('mounts no verb toolbar — and so no K/A/U/L/D hint — before a row is open', () => {
    // The keys are bound by the EXPANDED row's action toolbar. The list
    // used to print a `K · A · U · L · D` legend above a collapsed queue:
    // five shortcuts that did nothing. The legend is gone; the hints now
    // exist only on the toolbar that binds them.
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <TriageQueue rows={TRIAGE_QUEUE as readonly TriageDecisionRow[]} onAction={() => {}} />
      </QueryWrapper>,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByText('K · A · U · L · D')).not.toBeInTheDocument();
  });

  it('states the queue count nowhere — the header owns the one count', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <TriageQueue rows={TRIAGE_QUEUE as readonly TriageDecisionRow[]} onAction={() => {}} />
      </QueryWrapper>,
    );
    expect(screen.queryByText(/decisions waiting/)).toBeNull();
  });
});

it('carries fresh all-mail totals into the real inline preview and resets the future-only choice without dispatch', () => {
  const row = rowById('t-groupon');
  const store = useTriageStore.getState();
  store.openPending('Unsubscribe', row.id, 'inline', 2);
  store.setPendingBacklogMode('delete');
  store.setPendingReach('all_mail');
  store.setPendingOlderThanDays(180);
  const onConfirm = vi.fn();
  const preview = inlinePreviewFor(row.id, useTriageStore.getState().pendingAction, {
    inboxCount: 0,
    quotaRemaining: null,
    detail: {
      inboxTotal: 0,
      allMailTotal: 0,
      ageControl: {
        olderThanDays: 180,
        options: [{ days: null }, { days: 180 }],
        onChange: store.setPendingOlderThanDays,
      },
      reachControl: {
        reach: 'all_mail',
        inboxCount: 0,
        allMailCount: 0,
        onChange: store.setPendingReach,
      },
    },
  });
  expect(preview).not.toBeNull();
  render(
    <InlinePreviewBlock
      row={row}
      preview={preview!}
      busy={false}
      shortcutLive
      onConfirm={onConfirm}
    />,
  );
  expect(screen.getByText('No current Inbox or archived email to delete.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Unsubscribe + Delete' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Choose Unsubscribe only' }));
  expect(useTriageStore.getState().pendingAction).toMatchObject({
    backlogMode: 'unsub_only',
    reach: 'inbox_only',
    olderThanDays: null,
  });
  expect(onConfirm).not.toHaveBeenCalled();
});
