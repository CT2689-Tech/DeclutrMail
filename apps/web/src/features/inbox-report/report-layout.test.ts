import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'report.css'), 'utf8');

describe('inbox report desktop grid', () => {
  it('lets the stats column shrink inside the card at desktop widths', () => {
    const desktop = css.slice(css.indexOf('@container inbox-report (min-width: 40rem)'));
    expect(desktop).toContain('grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr)');
    expect(css).not.toContain('minmax(220px');
    expect(css).not.toContain('@media (min-width: 840px)');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('min-width: min(4ch, 100%)');
    expect(css).toMatch(/\.dm-report-glyphs \{[^}]*flex-wrap: wrap/s);
    expect(css).toMatch(/\.dm-report \{[^}]*max-width: 100%/s);
    expect(css).toMatch(/\.dm-report \{[^}]*min-width: 0/s);
  });
});
