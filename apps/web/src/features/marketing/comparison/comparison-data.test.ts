import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST, UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import {
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
  comparisonBySlug,
  comparisonVerifiedLabel,
} from './comparison-data';

const EXPECTED_SLUGS = [
  'clean-email',
  'trimbox',
  'sanebox',
  'leave-me-alone',
  'unroll-me',
  'gmail-filters',
  'gmail',
];

describe('comparison data', () => {
  it('publishes exactly the requested, statically addressable comparisons', () => {
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
      'unroll.me',
      // The regulator's own release, for the one claim no vendor page makes
      // about itself.
      'www.ftc.gov',
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
  });

  it('stamps each page with its own verification date and the hub with the oldest', () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const comparison of COMPARISONS) {
      expect(comparison.verifiedIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A freshness claim in the future is a claim nobody made.
      expect(comparison.verifiedIso <= today).toBe(true);
      expect(COMPARISONS_VERIFIED_FLOOR_ISO <= comparison.verifiedIso).toBe(true);
    }
    expect(comparisonVerifiedLabel('2026-07-11')).toBe('Last verified July 2026');
    expect(comparisonVerifiedLabel(comparisonBySlug('unroll-me')!.verifiedIso)).toBe(
      'Last verified August 2026',
    );
  });

  it('states the Activity Undo window on the recovery row instead of hedging, and keeps Gmail Trash literal (D245)', () => {
    const recovery = comparisonBySlug('clean-email')!.rows.find(
      (row) => row.label === 'Preview and recovery',
    )!.declutrMail;
    expect(recovery.detail).not.toContain('use the plan Activity Undo window');
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(recovery.detail).toContain(
        `Archive, Later, and Delete use the ${UNIFORM_UNDO_WINDOW_DAYS}-day Activity Undo window.`,
      );
    }
    // Gmail's own retention number is a separate fact and stays a literal
    // regardless of what the ladder does to ours.
    expect(recovery.detail).toContain(
      'Delete also has separate Gmail Trash recovery, normally up to 30 days.',
    );
  });

  it('keeps the Unroll.Me funding and enforcement claims tied to their own sources', () => {
    const unrollMe = comparisonBySlug('unroll-me')!;
    const hosts = unrollMe.sources.map((source) => new URL(source.url).hostname);
    expect(hosts).toContain('unroll.me');
    expect(hosts).toContain('www.ftc.gov');

    const funding = unrollMe.rows.find((row) => row.label === 'How the product is funded');
    // The vendor says this about itself; we quote rather than characterize.
    expect(funding?.competitor.detail).toContain('market research business, NielsenIQ');

    const history = unrollMe.rows.find((row) => row.label === 'Disclosure history');
    // "Alleged" is the FTC's own framing of a settled complaint. Stating it
    // as proven fact would be the exact misrepresentation this row is about.
    expect(history?.competitor.detail).toMatch(/alleged/i);
    expect(history?.declutrMail.detail).toMatch(/absence of a record/i);
    expect(JSON.stringify(unrollMe)).not.toMatch(/\bsteals?\b|\bspyware\b|\bscam\b/i);
  });
});
