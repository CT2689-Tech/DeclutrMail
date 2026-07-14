import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('reduced-motion CSS contract', () => {
  it('disables continuous loaders and minimizes global motion', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/\.dm-skeleton,[\s\S]*?\.dm-spinner[\s\S]*?animation: none !important/);
    expect(css).toMatch(/animation-duration: 0\.01ms !important/);
    expect(css).toMatch(/transition-duration: 0\.01ms !important/);
    expect(css).toMatch(/scroll-behavior: auto !important/);
  });
});
