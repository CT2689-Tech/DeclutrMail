import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '../entitlements';
import { TRUST_CLAIMS } from './app-shell';

describe('shell trust claims — undo windows', () => {
  it('states the window when the ladder is uniform, and never hedges past it', () => {
    const entry = TRUST_CLAIMS.find((e) => e.label === 'Undo windows');
    expect(entry).toBeDefined();
    if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
    expect(entry!.title).toContain(`${UNIFORM_UNDO_WINDOW_DAYS} days`);
    expect(entry!.title).not.toMatch(/your plan's Activity Undo window/i);
  });
});
