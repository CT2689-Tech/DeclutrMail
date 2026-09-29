import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/product-story/product-story.css'),
  'utf8',
);

describe('product-story style contract', () => {
  it('has no looping motion and honors reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/@keyframes/);
  });

  it('uses no ALL-CAPS labels', () => {
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
  });
});

describe('automation boundary figure — plan labels (D251)', () => {
  const diagrams = readFileSync(
    resolve(process.cwd(), 'src/features/marketing/product-story/diagrams.tsx'),
    'utf8',
  );

  it('derives the Autopilot plans from the tier manifest, never a literal', () => {
    // A hand-written "Pro" label here once contradicted the manifest
    // (preset rules start at Plus). Reading `capabilities` keeps the
    // label true when the ladder moves.
    expect(diagrams).toMatch(/capabilities\.includes\('autopilot'\)/);
    expect(diagrams).not.toMatch(/>\s*(?:Plus · Pro|Plus and Pro|Pro)\s*</);
    expect(TIER_MANIFEST.plus.capabilities).toContain('autopilot');
  });
});
