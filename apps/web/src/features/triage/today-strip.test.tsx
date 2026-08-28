// The Today strip must not overstate what a decision does, in either of the
// two ways it previously did.
//
//   TENSE — it read "can reduce future noise by ~N%", promising a FUTURE
//   effect from a measurement of mail ALREADY RECEIVED. Archive and Later both
//   declare `futureMail: { effect: 'unchanged' }`, Keep leaves delivery alone,
//   and Delete only trashes what already arrived, so four of the five verbs
//   change nothing about what arrives tomorrow.
//
//   SUBJECT — `noiseReductionPct`'s numerator excludes Keep rows while
//   `queuedDecisions` counts them, so attributing the share to "these senders"
//   overstates whenever a Keep row is queued. Invisible on a mailbox where
//   every queued row happens to be an unsubscribe, which is why it shipped.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TodayStripView } from './today-strip.js';

const BASE = {
  receivedToday: 184,
  sendersToday: 63,
  handledAutomatically: 129,
  queuedDecisions: 12,
  noiseSenderCount: 12,
  noiseReductionPct: 38,
};

describe('TodayStripView — the noise claim describes the past, and the right senders', () => {
  it('never promises a future reduction', () => {
    render(<TodayStripView summary={BASE} />);
    const strip = document.body.textContent ?? '';
    expect(strip).not.toMatch(/future noise/i);
    expect(strip).not.toMatch(/can reduce/i);
    expect(strip).toMatch(/received in the last 90 days/i);
  });

  it('attributes the share to every decision only when every decision counts toward it', () => {
    render(<TodayStripView summary={BASE} />);
    expect(screen.getByText(/These senders sent/i)).toBeInTheDocument();
  });

  it('makes no claim at all when the wire does not say which senders it describes', () => {
    // An older API revision answering a newer bundle omits `noiseSenderCount`.
    // Nothing validates the JSON, so the field arrives `undefined` — and
    // `undefined < 12` is FALSE, which fell through to the "These senders"
    // branch. A missing field degraded to the whole-queue falsehood rather
    // than to silence, restoring the bug the subset was added to remove.
    const { noiseSenderCount: _omitted, ...withoutCount } = BASE;
    render(<TodayStripView summary={withoutCount} />);
    const strip = document.body.textContent ?? '';
    expect(strip).not.toMatch(/These senders sent/i);
    expect(strip).not.toMatch(/of them sent/i);
    expect(strip).not.toContain('38%');
    // The rest of the strip still renders; only the unattributable claim goes.
    expect(strip).toMatch(/12/);
    expect(strip).toMatch(/waiting below/i);
  });

  it('makes no claim when the subset is larger than the queue it is a subset of', () => {
    // Not producible by the current API — it is a filter of the queue rows —
    // but the wire is unvalidated, and two numbers that cannot both be true
    // are evidence they came from different snapshots.
    render(<TodayStripView summary={{ ...BASE, queuedDecisions: 3, noiseSenderCount: 9 }} />);
    const strip = document.body.textContent ?? '';
    expect(strip).not.toMatch(/These senders sent/i);
    expect(strip).not.toMatch(/of them sent/i);
    expect(strip).toMatch(/waiting below/i);
  });

  it('uses a singular subject when the one queued sender is the whole subset', () => {
    // Equal counts took the plural branch unconditionally, so a queue of one
    // read "1 sender decision. These senders sent ~38% …".
    render(<TodayStripView summary={{ ...BASE, queuedDecisions: 1, noiseSenderCount: 1 }} />);
    const strip = document.body.textContent ?? '';
    expect(strip).toMatch(/This sender sent/i);
    expect(strip).not.toMatch(/These senders sent/i);
    expect(strip).toMatch(/1 sender decision\b/);
  });

  it('names the subset when Keep rows are queued, instead of crediting all of them', () => {
    // 12 decisions, 10 contributing: the share belongs to the 10.
    render(<TodayStripView summary={{ ...BASE, queuedDecisions: 12, noiseSenderCount: 10 }} />);
    const strip = document.body.textContent ?? '';
    expect(strip).toMatch(/of them sent/i);
    expect(strip).toContain('10');
    // The bug: the whole queue credited with a subset's volume.
    expect(strip).not.toMatch(/These senders sent/i);
  });
});
