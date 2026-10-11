import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { baselineKey, scanGlossaryHits, type BaselineEntry } from './ui-glossary-scan';
import { glossaryHits, loadUiGlossary, parseUiGlossary } from './ui-glossary';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('ui glossary', () => {
  const glossary = loadUiGlossary();

  it('fails a fixture for every banned pattern', () => {
    const samples: Record<string, string> = {
      clean_verb: 'Please clean your inbox',
      action_word: 'Take an action on this sender',
      sync_word: 'Sync is still running',
      metadata_word: 'We only store metadata',
      workspace_word: 'Your workspace is ready',
      quota_word: 'You hit the quota',
      allowance_word: 'Your allowance is used up',
      storage_claim: 'This will free up space',
      certification_claim: 'Google certified this app',
      opened_claim: 'You opened this email',
      body_counterclaim: 'DeclutrMail never reads your email',
      superlative: 'The best inbox tool',
      price_literal: 'Plus is $19 a year',
      contact_promise: "We'll email you when it launches",
    };
    for (const ban of glossary.banned) {
      if (ban.scope === 'report') {
        expect(
          glossaryHits('They rarely write', glossary, 'report').map((hit) => hit.id),
        ).toContain('rarely_word');
        expect(glossaryHits('They rarely write', glossary, 'all')).toEqual([]);
        continue;
      }
      const sample = samples[ban.id];
      expect(sample, ban.id).toBeTruthy();
      expect(glossaryHits(sample, glossary).some((hit) => hit.id === ban.id)).toBe(true);
    }
  });

  it('allows an exact Cleanup noun and a code identifier', () => {
    expect(glossaryHits('Cleanup', glossary)).toEqual([]);
    expect(glossaryHits('sync_started', glossary)).toEqual([]);
    expect(glossaryHits('/settings/privacy#what-we-store', glossary)).toEqual([]);
  });

  it('rejects a drifted glossary document', () => {
    const parsed = parseUiGlossary('allowed_names:\n  - "Home"\nbanned:\nallow_exact:\ndefs:\n');
    expect(parsed.allowedNames).toEqual(['Home']);
    expect(parsed.banned).toEqual([]);
  });

  it('does not grow the shrink-only baseline', () => {
    const baselinePath = join(HERE, 'glossary-baseline.json');
    const current = scanGlossaryHits(glossary);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BaselineEntry[];
    const known = new Set(baseline.map(baselineKey));
    const novel = current.filter((entry) => !known.has(baselineKey(entry)));
    expect(novel).toEqual([]);
  });
});
