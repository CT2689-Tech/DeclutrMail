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

import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { TRIAGE_QUEUE, type TriageDecisionRow } from './data';
import { resetTriageStore } from './store';
import { TriageQueue } from './triage-queue';

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

describe('the shortcut legend tells the truth about when the keys work', () => {
  beforeEach(() => {
    resetTriageStore();
  });

  it('does not advertise live keys before a row is open', () => {
    // The keys are bound by the EXPANDED row's action toolbar, so with the
    // queue collapsed `K · A · U · L · D` promised five shortcuts that did
    // nothing. A first-timer presses one, nothing happens, and the screen has
    // taught them the app is broken.
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <TriageQueue rows={TRIAGE_QUEUE as readonly TriageDecisionRow[]} onAction={() => {}} />
      </QueryWrapper>,
    );
    expect(screen.getByTitle('Open a row to use these keys')).toBeInTheDocument();
    expect(screen.queryByText('K · A · U · L · D')).not.toBeInTheDocument();
  });
});
