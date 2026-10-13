import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'activity-screen.module.css'),
  'utf8',
);

describe('activity summary tiles', () => {
  it('wraps tiles inside the page instead of scrolling them out of view', () => {
    expect(css).toContain('repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr))');
    expect(css).not.toContain('overflow-x: auto');
    expect(css).not.toContain('repeat(5, minmax(0, 1fr))');
    expect(css).toMatch(/\.summaryTiles > button \{[^}]*overflow-wrap: anywhere/s);
    expect(css).toMatch(/\.summary \{[^}]*min-width: 0/s);
    expect(css).toMatch(/\.summary \{[^}]*max-width: 100%/s);
  });
});
