import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';

import { COMPARISONS, COMPARISON_VERIFIED_LABEL, comparisonBySlug } from './comparison-data';

const EXPECTED_SLUGS = ['clean-email', 'trimbox', 'sanebox', 'leave-me-alone', 'gmail-filters'];

describe('comparison data', () => {
  it('publishes exactly the five requested, statically addressable comparisons', () => {
    expect(COMPARISONS.map((comparison) => comparison.slug)).toEqual(EXPECTED_SLUGS);
    for (const slug of EXPECTED_SLUGS) {
      expect(comparisonBySlug(slug)?.rows.length).toBeGreaterThanOrEqual(8);
    }
    expect(comparisonBySlug('invented-tool')).toBeUndefined();
  });

  it('has balanced choose-either-product guidance on every page', () => {
    for (const comparison of COMPARISONS) {
      expect(comparison.chooseCompetitor.points.length).toBeGreaterThanOrEqual(3);
      expect(comparison.chooseDeclutrMail.points.length).toBeGreaterThanOrEqual(3);
      expect(comparison.verdict).toContain(comparison.name);
      expect(comparison.verdict).toContain('DeclutrMail');
    }
  });

  it('uses official HTTPS sources and explains what each source establishes', () => {
    const allowedHosts = new Set([
      'clean.email',
      'www.trimbox.io',
      'www.sanebox.com',
      'leavemealone.com',
      'support.google.com',
    ]);

    for (const comparison of COMPARISONS) {
      expect(comparison.sources.length).toBeGreaterThanOrEqual(3);
      for (const source of comparison.sources) {
        const url = new URL(source.url);
        expect(url.protocol).toBe('https:');
        expect(allowedHosts.has(url.hostname)).toBe(true);
        expect(source.note.length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps uncertainty explicit rather than converting it into a no', () => {
    const unknowns = COMPARISONS.flatMap((comparison) =>
      comparison.rows.flatMap((row) => [row.declutrMail, row.competitor]),
    ).filter((cell) => cell.state === 'unknown');

    expect(unknowns.length).toBeGreaterThanOrEqual(4);
    for (const cell of unknowns) {
      expect(`${cell.summary} ${cell.detail ?? ''}`).toMatch(
        /not public|not (?:clearly )?stated|not publish/i,
      );
    }
  });

  it('states current DeclutrMail limits instead of promising blanket future policy or universal undo', () => {
    const copy = JSON.stringify(COMPARISONS);
    expect(copy).toContain('does not automatically become a future-mail rule');
    expect(copy).toContain('Unsubscribe is not a reversible DeclutrMail action');
    expect(copy).not.toMatch(/every decision keeps running|all actions are undoable/i);
    for (const point of [
      TIER_MANIFEST.plus.prices.monthly,
      TIER_MANIFEST.plus.prices.annual,
      TIER_MANIFEST.pro.prices.monthly,
      TIER_MANIFEST.pro.prices.annual,
      TIER_MANIFEST.pro.promo?.annual,
    ]) {
      expect(point).toBeTruthy();
      expect(copy).toContain(`$${(point?.usdCents ?? 0) / 100}`);
    }
    expect(COMPARISON_VERIFIED_LABEL).toBe('Last verified July 2026');
  });
});
