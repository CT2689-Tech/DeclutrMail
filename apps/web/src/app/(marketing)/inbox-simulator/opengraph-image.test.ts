import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { undoWindowCaption } from './opengraph-image';

describe('/inbox-simulator open graph card', () => {
  it('states the Undo window on the action-preview caption instead of hedging (D245)', () => {
    expect(undoWindowCaption).not.toContain("your plan's Undo window");
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(undoWindowCaption).toBe(
        `Undo from Activity during the ${UNIFORM_UNDO_WINDOW_DAYS}-day Undo window.`,
      );
    }
  });
});
