import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RowActivityPill, rowActivityLabel, type SenderRowActivity } from './row-activity';

// Founder report 2026-09-20: "After selecting any action … I did not have
// any clue if request submitted, went through. Rows stay as-is for long
// time." The row the user clicked is where their eyes are.
describe('row activity — what a sender row says about its own action', () => {
  it.each([
    [{ phase: 'working', verb: 'archive' }, 'Archiving…'],
    [{ phase: 'working', verb: 'later' }, 'Moving to Later…'],
    [{ phase: 'working', verb: 'delete' }, 'Moving to Trash…'],
    [{ phase: 'done', verb: 'archive', affectedCount: 12 }, 'Archived · 12 emails'],
    [{ phase: 'done', verb: 'delete', affectedCount: 1 }, 'Deleted to Gmail Trash · 1 email'],
    [{ phase: 'done', verb: 'later', affectedCount: null }, 'Moved to Later'],
    [{ phase: 'done', verb: 'delete', affectedCount: 0 }, 'Nothing to change'],
    [{ phase: 'failed', verb: 'delete' }, 'Delete failed'],
    [{ phase: 'unconfirmed', verb: 'archive' }, 'Archive still running'],
  ] as Array<[SenderRowActivity, string]>)('%o reads "%s"', (activity, label) => {
    expect(rowActivityLabel(activity)).toBe(label);
  });

  it('never prints a count it was not given — a bulk member has no per-sender figure', () => {
    expect(rowActivityLabel({ phase: 'done', verb: 'delete', affectedCount: null })).not.toMatch(
      /\d/,
    );
  });

  it('marks the pill by phase, and is NOT a live region (a bulk would announce N times)', () => {
    render(<RowActivityPill activity={{ phase: 'working', verb: 'delete' }} />);
    const pill = screen.getByText('Moving to Trash…');
    expect(pill).toHaveAttribute('data-dm-row-activity', 'working');
    expect(pill).not.toHaveAttribute('role');
  });
});
