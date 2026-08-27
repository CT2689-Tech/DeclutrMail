import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST } from './pricing.config';
import { TIER_IDS } from './types';
import { UNIFORM_UNDO_WINDOW_DAYS } from './undo-window';

describe('UNIFORM_UNDO_WINDOW_DAYS', () => {
  it('is the shared window when every tier agrees, and null when they do not', () => {
    const windows = TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays);
    const allEqual = windows.every((d) => d === windows[0]);

    // Derived, not asserted: this test states the RULE, so it keeps
    // holding when the ladder changes. Pinning the literal 30 here would
    // re-create the drift the constant exists to prevent.
    expect(UNIFORM_UNDO_WINDOW_DAYS).toBe(allEqual ? windows[0] : null);
  });

  it('is a positive whole number of days whenever it is not null', () => {
    if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
    expect(Number.isSafeInteger(UNIFORM_UNDO_WINDOW_DAYS)).toBe(true);
    expect(UNIFORM_UNDO_WINDOW_DAYS).toBeGreaterThan(0);
  });
});
