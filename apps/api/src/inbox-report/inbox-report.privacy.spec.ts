import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const FILES = [
  'inbox-report.queries.ts',
  'inbox-report.service.ts',
  'inbox-report.controller.ts',
  'inbox-report.module.ts',
];

describe('inbox report privacy', () => {
  it('never reads a message subject, preview, narrative, or a model client', () => {
    const banned = /\bsubject\b|\bsnippet\b|\bbrief\b|anthropic/i;
    for (const file of FILES) {
      const source = readFileSync(join(import.meta.dirname, file), 'utf8');
      expect(source, file).not.toMatch(banned);
    }
  });
});
