/**
 * Tests for `TriageEmptyState` — the D212 resting-queue / D33
 * completion component.
 *
 * Covers QA-sync-20260831-01: the resting state must not claim
 * "nothing to do" when the active mailbox's sync has terminally failed
 * — Triage otherwise has zero sync awareness of any kind.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { TRIAGE_SESSION_STATS } from './data';
import { TriageEmptyState } from './empty-state';

describe('TriageEmptyState', () => {
  it('renders the D212 resting-queue copy when the mailbox is caught up', () => {
    render(<TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 0 }} />);
    expect(screen.getByText('Nothing needs a decision right now.')).toBeInTheDocument();
  });

  it('does not claim "nothing needs a decision" while the mailbox scan has failed (QA-sync-20260831-01)', () => {
    // The negative control: reverting the `syncFailed` branch in
    // `empty-state.tsx` makes this assertion fail — Triage has no other
    // sync input, so a resting-queue read during a broken scan renders
    // the same confident "caught up" claim as a genuinely-synced mailbox.
    render(
      <TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 0 }} syncFailed={true} />,
    );
    expect(screen.getByText("This mailbox's last scan didn't finish.")).toBeInTheDocument();
    expect(screen.queryByText('Nothing needs a decision right now.')).not.toBeInTheDocument();
  });

  it('does not render the sync-failed copy once the user has decided something today', () => {
    // `decidedToday > 0` is the D33 celebration state, unconditional on
    // sync health — a session that already made progress should not be
    // told the scan failed on top of it (a different job's screen, and
    // this run's approved scope, both stop at the resting state).
    render(
      <TriageEmptyState stats={{ ...TRIAGE_SESSION_STATS, decidedToday: 3 }} syncFailed={true} />,
    );
    expect(screen.queryByText("This mailbox's last scan didn't finish.")).not.toBeInTheDocument();
  });
});
