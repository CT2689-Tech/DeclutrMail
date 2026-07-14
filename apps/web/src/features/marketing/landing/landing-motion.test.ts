import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/landing/landing.css'),
  'utf8',
);

describe('landing motion contract', () => {
  it('runs the illustrative action once instead of looping indefinitely', () => {
    for (const animation of ['row', 'strike', 'press', 'receipt', 'toast']) {
      expect(css).not.toMatch(new RegExp(`dm-mkt-${animation}[^;]*infinite`));
      expect(css).toMatch(new RegExp(`dm-mkt-${animation} 8s 1 forwards`));
    }
  });

  it('finishes with the completed receipt visible', () => {
    const receiptKeyframes = css.slice(css.indexOf('@keyframes dm-mkt-receipt'));
    expect(receiptKeyframes).toMatch(/100%\s*\{[\s\S]*?opacity:\s*1;/);
    expect(receiptKeyframes).toMatch(/100%\s*\{[\s\S]*?transform:\s*scale\(1\);/);
  });
});
