/**
 * D245 regression guard — the durable half of "state the Undo window
 * instead of hedging".
 *
 * Three prior sweeps on this plan each claimed every hedged site was found
 * and fixed, and each was wrong, because a regex over SOURCE TEXT has to
 * anticipate every apostrophe spelling ('  &apos;  &#39;  &#x27;  U+2019)
 * and every phrasing ("your plan's", "the plan", "plan-based", "depends on
 * your plan"). That is the wrong instrument — it is a moving target.
 *
 * This asserts on the RESOLVED, EXPORTED copy values instead. Whatever the
 * source code says (a ternary, a concatenation, whatever shape a future
 * edit takes), the value actually imported today is already either the
 * derived string (ladder uniform) or the honest hedge (ladder diverged) —
 * so there is nothing left to mis-spell. A regression can only happen by
 * hard-coding a hedge phrase back into one of these exports, which this
 * test catches regardless of which apostrophe character it uses, because
 * apostrophes are normalised on the resolved value before matching.
 *
 * Scope: the six content/route modules Task 7 converted. Component-level
 * sites fixed by earlier tasks in this plan (action-sheet.tsx,
 * batch-action-sheet.tsx, noise-archive-sheet.tsx, privacy-data-screen.tsx,
 * review-session.tsx's commit bar, app-shell.tsx, gmail-data-inventory.ts)
 * already have their own per-site regression tests from those tasks; they
 * are not re-scanned here because their hedge text lives inside rendered
 * JSX, not a plain exported value, which is exactly the shape this guard's
 * "import and read" approach is meant to avoid needing to render.
 *
 * Skipped entirely while UNIFORM_UNDO_WINDOW_DAYS is null: with a
 * divergent ladder, "depends on your plan" is literally true, and every
 * module below is expected to say so via its own null-branch fallback.
 */
import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

import { GLOSSARY_TERMS } from '@/features/help/glossary-content';
import { COMPARISONS } from '@/features/marketing/comparison/comparison-data';
import { FAQ_ENTRIES } from '@/features/marketing/learn/faq-content';
import { HOW_TO_ARTICLES } from '@/features/marketing/learn/how-to-content';

import { undoWindowCaption } from './inbox-simulator/opengraph-image';
import { GET as pricingMarkdown } from './pricing.md/route';

/**
 * Collapses every apostrophe spelling this plan has been defeated by onto
 * one canonical character before matching, per the brief's explicit
 * instruction — so the guard cannot be beaten by a sixth spelling.
 */
function normalizeApostrophes(value: string): string {
  return value.replace(/&apos;|&#39;|&#x27;/gi, "'").replace(/’/g, "'");
}

/**
 * Each pattern targets "plan" co-occurring with the undo/recovery-window
 * concept specifically, rather than the bare word "plan" — the same
 * modules legitimately say things like "Active execution depends on your
 * plan" (Autopilot tier gating, GLOSSARY_TERMS.active) and "Compare
 * current plans" (a nav label), which are true regardless of whether the
 * Undo window ladder is uniform and must not be flagged.
 */
const HEDGE_PATTERNS: readonly RegExp[] = [
  // "plan-based window", "plan-based recovery window", "plan-based Undo"
  /plan-based/i,
  // "plan's Undo window", "plan's Activity Undo window", "the plan Activity
  // Undo window" (no apostrophe — the exact pre-existing phrasing task 6
  // found in a null-branch fallback), "plan's undo window"
  /\bplan(?:'s)?\s+(?:activity\s+)?(?:undo|recovery|window)\b/i,
  // "(its length depends on your plan)" — deliberately requires "length"
  // so it does not also match the unrelated, still-true Autopilot
  // sentence above.
  /length depends on (?:your |the )?plan\b/i,
];

interface CopySample {
  readonly label: string;
  readonly text: string;
}

async function collectCopySamples(): Promise<CopySample[]> {
  return [
    { label: 'glossary-content GLOSSARY_TERMS', text: JSON.stringify(GLOSSARY_TERMS) },
    { label: 'comparison-data COMPARISONS', text: JSON.stringify(COMPARISONS) },
    { label: 'faq-content FAQ_ENTRIES', text: JSON.stringify(FAQ_ENTRIES) },
    { label: 'how-to-content HOW_TO_ARTICLES', text: JSON.stringify(HOW_TO_ARTICLES) },
    { label: 'opengraph-image undoWindowCaption', text: undoWindowCaption },
    { label: 'pricing.md GET() markdown body', text: await pricingMarkdown().text() },
  ];
}

function hedgeHits(samples: readonly CopySample[]): string[] {
  return samples.flatMap(({ label, text }) => {
    const normalized = normalizeApostrophes(text);
    return HEDGE_PATTERNS.filter((pattern) => pattern.test(normalized)).map(
      (pattern) => `${label} matched ${pattern}`,
    );
  });
}

describe('undo-window copy — regression guard (D245)', () => {
  // Step 5's blind case: a guard whose input set is empty is vacuously
  // green and certifies nothing. Assert the set is real, not just that
  // scanning it found nothing.
  it('checks a non-empty set of public copy modules', async () => {
    const samples = await collectCopySamples();
    expect(samples.length).toBeGreaterThanOrEqual(6);
    for (const sample of samples) {
      expect(sample.text.length, sample.label).toBeGreaterThan(0);
    }
  });

  it.skipIf(UNIFORM_UNDO_WINDOW_DAYS === null)(
    'contains no plan-dependency hedge in any of the six public copy modules',
    async () => {
      const samples = await collectCopySamples();
      expect(hedgeHits(samples)).toEqual([]);
    },
  );
});
