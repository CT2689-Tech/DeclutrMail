import { describe, expect, it } from 'vitest';
import { loadUiGlossary } from '../copy/ui-glossary';
import { NAV_GROUP_LABEL } from '../copy/screen-decisions';
import { labelSet, NAV_GROUP, RETIRED_NAV_LABELS } from './use-labels';

describe('nav names', () => {
  const glossary = loadUiGlossary();

  it('uses one name map for both label modes', () => {
    expect(labelSet('plain')).toEqual(labelSet('power'));
    expect(NAV_GROUP).toBe(NAV_GROUP_LABEL);
    expect(labelSet().brief).toBe('Daily Brief');
    expect(labelSet().billing).toBe('Plan & billing');
  });

  it('does not use a retired name', () => {
    const values = Object.values(labelSet());
    for (const retired of RETIRED_NAV_LABELS) {
      expect(values).not.toContain(retired);
    }
  });

  it('keeps nav labels inside the glossary allow list', () => {
    for (const value of Object.values(labelSet())) {
      expect(glossary.allowedNames).toContain(value);
    }
    expect(glossary.allowedNames).toContain(NAV_GROUP);
  });
});
