import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/marketing/product-story/product-story.css'),
  'utf8',
);

describe('product-story motion contract', () => {
  it('keeps the walkthrough readable without animation and honors reduced motion', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/dm-story-focus[^;]*infinite/);
    expect(css).toMatch(/\.dm-story-walkthrough-step\s*{[^}]*opacity:\s*1;/s);
    expect(css).toMatch(/\.dm-story-walkthrough-step\s*{[^}]*animation:\s*none !important;/s);
    expect(css).toMatch(/\.dm-story-button:hover\s*{[^}]*transform:\s*none;/s);
  });

  it('uses inverse text for callouts placed on ink sections', () => {
    expect(css).toMatch(
      /\.dm-story-section-ink \.dm-story-callout\s*{[^}]*color:\s*var\(--dm-fg-inverse-soft\);/s,
    );
  });
});
