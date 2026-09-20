import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RowActivityPill,
  RowActivityStatus,
  rowActivityLabel,
  rowStatusLabel,
  type SenderRowActivity,
} from './row-activity';

// Founder report 2026-09-20: "After selecting any action … I did not have
// any clue if request submitted, went through. Rows stay as-is for long
// time." The row the user clicked is where their eyes are.
describe('row activity — what a sender row says about its own action', () => {
  it.each([
    [{ phase: 'working', verb: 'archive' }, 'Archiving…'],
    [{ phase: 'working', verb: 'later' }, 'Moving to Later…'],
    [{ phase: 'working', verb: 'delete' }, 'Deleting…'],
    [{ phase: 'done', verb: 'archive', affectedCount: 12 }, 'Archived · 12 emails'],
    [{ phase: 'done', verb: 'delete', affectedCount: 1 }, 'Deleted · 1 email'],
    [{ phase: 'done', verb: 'later', affectedCount: null }, 'Moved to Later'],
    [{ phase: 'done', verb: 'delete', affectedCount: 0 }, 'Nothing to change'],
    [{ phase: 'failed', verb: 'delete' }, 'Delete failed'],
    [{ phase: 'unconfirmed', verb: 'archive' }, 'Archive not confirmed'],
    [{ phase: 'mixed', verb: 'delete' }, 'Delete: see Activity'],
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
    const pill = screen.getByText('Deleting…');
    expect(pill).toHaveAttribute('data-dm-row-activity', 'working');
    expect(pill).not.toHaveAttribute('role');
  });

  // Founder feedback 2026-09-20: the mark beside the name was "not
  // highlighted" — the button the user pressed becomes the status.
  it.each([
    [{ phase: 'working', verb: 'delete' }, 'Deleting…'],
    [{ phase: 'done', verb: 'delete', affectedCount: 95 }, 'Deleted 95'],
    [{ phase: 'done', verb: 'archive', affectedCount: null }, 'Archived'],
    [{ phase: 'done', verb: 'later', affectedCount: 0 }, 'Nothing to change'],
    [{ phase: 'unconfirmed', verb: 'archive' }, 'Archive not confirmed'],
  ] as Array<[SenderRowActivity, string]>)('button slot: %o reads "%s"', (activity, label) => {
    expect(rowStatusLabel(activity)).toBe(label);
  });

  it('spins silently while working — never a live region per row', () => {
    const { container } = render(
      <RowActivityStatus activity={{ phase: 'working', verb: 'delete' }} />,
    );
    expect(container.querySelector('[role="status"], [aria-live]')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('tints a part-failed bulk as a caution, not a neutral note', () => {
    render(<RowActivityPill activity={{ phase: 'mixed', verb: 'delete' }} />);
    expect(screen.getByText('Delete: see Activity').style.background).toBe('var(--dm-amber-bg)');
  });
});
