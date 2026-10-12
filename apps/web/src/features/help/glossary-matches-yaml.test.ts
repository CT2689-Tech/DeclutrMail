import { describe, expect, it } from 'vitest';
import { loadUiGlossary } from '@declutrmail/shared/copy/ui-glossary';
import { GLOSSARY_TERMS } from './glossary-content';

describe('help glossary', () => {
  it('matches the YAML definitions', () => {
    const glossary = loadUiGlossary();
    for (const entry of Object.values(GLOSSARY_TERMS)) {
      expect(glossary.defs[entry.term]).toBe(entry.definition);
    }
  });
});
