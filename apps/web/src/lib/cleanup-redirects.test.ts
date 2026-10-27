import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanupRedirects } from './cleanup-redirects';

const require = createRequire(import.meta.url);
const { prepareDestination } =
  require('next/dist/shared/lib/router/utils/prepare-destination.js') as {
    prepareDestination: (input: {
      appendParamsToQuery: boolean;
      destination: string;
      params: Record<string, string>;
      query: Record<string, string>;
    }) => { parsedDestination: { pathname: string; query: Record<string, string> } };
  };

describe('legacy cleanup links', () => {
  it.each(cleanupRedirects())('redirects $source before rendering, preserving scope', (rule) => {
    const destination = prepareDestination({
      appendParamsToQuery: false,
      destination: rule.destination,
      params: {},
      query: { q: 'synthetic', sort: 'volume', view: 'all' },
    }).parsedDestination;
    expect(destination.pathname).toBe('/senders');
    expect(destination.query).toEqual({
      q: 'synthetic',
      sort: 'volume',
      view: rule.source === '/triage' ? 'guided' : 'first-review',
    });
    expect(rule.permanent).toBe(false);
    expect(existsSync(path.join(process.cwd(), `src/app/(app)${rule.source}/page.tsx`))).toBe(
      false,
    );
    expect(readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8')).toContain(
      '...cleanupRedirects()',
    );
  });
});
