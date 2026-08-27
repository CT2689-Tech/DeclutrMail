import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST, UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import {
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
  ALTERNATIVES_SLUGS,
  alternativesFor,
  comparisonBySlug,
  comparisonVerifiedLabel,
  ROUNDUP_DIMENSIONS,
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

  it('states the recovery window on the Gmail-filters "choose DeclutrMail" bullet instead of hedging (D245)', () => {
    const points = comparisonBySlug('gmail-filters')!.chooseDeclutrMail.points;
    expect(points.some((point) => point.includes('plan-based recovery window'))).toBe(false);
    if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
      expect(
        points.some((point) =>
          point.includes(
            `a ${UNIFORM_UNDO_WINDOW_DAYS}-day recovery window for Gmail label changes`,
          ),
        ),
      ).toBe(true);
    }
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

describe('alternatives round-ups stay honest', () => {
  it('publishes a page for every real product and none for Gmail itself', () => {
    // "Gmail alternatives" is a search for a different mail provider,
    // not for a cleanup tool. Ranking for it would win an intent this
    // product cannot serve.
    expect([...ALTERNATIVES_SLUGS].sort()).toEqual([
      'clean-email',
      'leave-me-alone',
      'sanebox',
      'trimbox',
      'unroll-me',
    ]);
    expect(alternativesFor('gmail')).toBeUndefined();
    expect(alternativesFor('gmail-filters')).toBeUndefined();
    expect(alternativesFor('not-a-tool')).toBeUndefined();
  });

  it('never places DeclutrMail first among the alternatives', () => {
    // The failure this guards is the one every competing round-up
    // commits: publish "honest alternatives", rank yourself number one.
    // Order here follows COMPARISONS, so DeclutrMail is not even in the
    // list — it gets its own clearly-labelled section instead.
    for (const slug of ALTERNATIVES_SLUGS) {
      const page = alternativesFor(slug);
      expect(page, slug).toBeDefined();
      const names = page!.alternatives.map((alternative) => alternative.name);
      expect(names, slug).not.toContain('DeclutrMail');
      expect(names[0], `${slug} leads with a competitor, not the subject`).not.toBe(
        page!.subject.name,
      );
    }
  });

  it('never lists the subject as an alternative to itself', () => {
    for (const slug of ALTERNATIVES_SLUGS) {
      const page = alternativesFor(slug)!;
      expect(
        page.alternatives.map((a) => a.slug),
        slug,
      ).not.toContain(page.slug);
      expect(page.alternatives.length, slug).toBe(COMPARISONS.length - 1);
    }
  });

  it('reuses the comparison copy rather than writing new claims', () => {
    // Identity again: an alternatives entry must be the same words the
    // /vs page publishes with its sources. Anything else is an unsourced
    // claim about a third party.
    for (const slug of ALTERNATIVES_SLUGS) {
      const page = alternativesFor(slug)!;
      for (const alternative of page.alternatives) {
        const source = comparisonBySlug(alternative.slug)!;
        expect(alternative.headline).toBe(source.chooseCompetitor.headline);
        expect(alternative.points).toBe(source.chooseCompetitor.points);
        expect(alternative.primaryUnit).toBe(source.primaryUnit);
      }
    }
  });

  it('claims the oldest verification date on the page, never the freshest', () => {
    for (const slug of ALTERNATIVES_SLUGS) {
      const page = alternativesFor(slug)!;
      const shown = [page.subject, ...COMPARISONS].map((c) => c.verifiedIso);
      expect(page.verifiedIso, slug).toBe(shown.reduce((a, b) => (b < a ? b : a)));
      expect(page.verifiedIso, slug).toBe(COMPARISONS_VERIFIED_FLOOR_ISO);
    }
  });
});

describe('the multi-way matrix is pivoted, never restated', () => {
  // Blind case first. The pivot is derived, so an empty or near-empty
  // result would make every assertion below vacuously true while the
  // page rendered a table with nothing in it.
  it('derives dimensions at all', () => {
    expect(ROUNDUP_DIMENSIONS.length, 'pivot produced no dimensions').toBeGreaterThanOrEqual(5);
    for (const dimension of ROUNDUP_DIMENSIONS) {
      expect(dimension.competitors.length).toBe(COMPARISONS.length);
    }
  });

  it('reuses the exact cell objects the 1v1 pages render', () => {
    // Identity, not deep equality. If the matrix ever holds its own copy
    // of a fact, the two surfaces can drift and a reader gets one answer
    // head-to-head and another in the table.
    for (const dimension of ROUNDUP_DIMENSIONS) {
      for (const [slug, cell] of dimension.competitors) {
        if (!cell) continue;
        const source = comparisonBySlug(slug)?.rows.find((row) => row.label === dimension.label);
        expect(cell, `${slug} / ${dimension.label}`).toBe(source?.competitor);
      }
    }
  });

  it('collapses DeclutrMail to one shared cell per dimension', () => {
    // What makes a single DeclutrMail column honest: every 1v1 page
    // already points at the same object, so the matrix is not choosing
    // one page's wording over another's. A page that hand-writes its own
    // DeclutrMail cell fails here rather than silently disagreeing.
    for (const dimension of ROUNDUP_DIMENSIONS) {
      const perPage = COMPARISONS.flatMap((comparison) => {
        const row = comparison.rows.find((candidate) => candidate.label === dimension.label);
        return row ? [row.declutrMail] : [];
      });
      for (const cell of perPage) {
        expect(cell, `${dimension.label} differs between comparison pages`).toBe(
          dimension.declutrMail,
        );
      }
    }
  });

  it('renders a gap as a gap, never as an implied no', () => {
    // A competitor that does not compare on a dimension must come back
    // undefined so the view can say so. Coercing it to a "no" would
    // manufacture a claim from silence — the same rule as `unknown`.
    const gaps = ROUNDUP_DIMENSIONS.flatMap((dimension) =>
      dimension.competitors.filter(([, cell]) => cell === undefined),
    );
    for (const [, cell] of gaps) {
      expect(cell).toBeUndefined();
    }
  });
});
