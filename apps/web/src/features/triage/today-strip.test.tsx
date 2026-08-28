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
