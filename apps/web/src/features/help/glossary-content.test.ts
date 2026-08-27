import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements/undo-window';

import { GLOSSARY_TERMS } from './glossary-content';

describe('glossary content', () => {
  it('states the Activity Undo window instead of hedging (D245)', () => {
    const { definition } = GLOSSARY_TERMS.activityUndo;
    expect(definition).not.toContain('plan-based');
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(definition).toContain(`DeclutrMail's ${UNIFORM_UNDO_WINDOW_DAYS}-day window`);
    }
  });
});
