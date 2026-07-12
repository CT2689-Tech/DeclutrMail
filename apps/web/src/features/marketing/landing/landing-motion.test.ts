import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/landing/landing.css'),
  'utf8',
);

describe('landing motion contract', () => {
  it('runs the illustrative action once instead of looping indefinitely', () => {
    for (const animation of ['row', 'strike', 'press', 'toast']) {
      expect(css).not.toMatch(new RegExp(`dm-mkt-${animation}[^;]*infinite`));
      expect(css).toMatch(new RegExp(`dm-mkt-${animation} 8s 1 forwards`));
    }
  });
});
