# Marketing Surface Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the concrete gaps found by the 2026-08-29 Marketing Surface Audit (SEO technical/on-page + positioning/pricing-clarity/IA/competitive-claims review) — two SEO truncation bugs, one undisclosed real paywall, one internally-contradicted homepage claim, one orphaned page class, one thin explanation gap, and one stale-copy nit — without touching anything the audit found already correct.

**Architecture:** No new components, no new abstractions. Every task edits copy or a derived-data function in an existing file, following the pattern already established in that file (manifest-derived tables stay manifest-derived; `StorySection`-based pages get another `StorySection`; card-grid comparison pages get another card grid). Nothing here changes entitlement logic, pricing, OAuth scopes, or billing — only what is _disclosed_ about behavior that already exists.

**Tech Stack:** Next.js App Router (apps/web), Vitest + React Testing Library for component/unit tests, the existing `@declutrmail/shared/entitlements` manifest as the single source of truth for anything price- or tier-related.

## Global Constraints

- **Tier 2 content work (CLAUDE.md §2.0).** None of these eight tasks touch Gmail OAuth scopes, token handling, billing mutation logic, webhook auth, migrations, or the no-body-storage privacy boundary — they only add or correct _disclosure copy_ about behavior the product already has. No D-number required; ship on convention (CLAUDE.md §4).
- **Canonical verbs only (D227).** Any new copy uses exactly Keep / Archive / Unsubscribe / Later / Delete for user-facing actions. "Screen" never appears as a standalone word; "Screener" is the allowed feature name.
- **Never fabricate a claim (Tier 1b).** Task 8 (competitor date refresh) requires actually re-reading each competitor's live pricing/help pages before touching a verification date — bumping a date without checking is exactly the failure mode Tier 1b exists to catch.
- **Surgical changes only (CLAUDE.md §1.3).** Every task's diff should be reviewable on its own; don't touch a neighboring line "while you're in there."
- **Negative control per new assertion (CLAUDE.md §8).** Every new test in this plan must be shown failing against the pre-fix code before the fix lands, not just passing after.
- **Manifest derives, never hardcode (recurring codebase rule).** No task should introduce a second place that knows a price, tier name, or capability gate — everything routes through `TIER_MANIFEST` / `SELECTOR_TIERS` in `packages/shared/src/entitlements/pricing.config.ts`.

## Not scheduled here — needs your call first

**Unifying the four different top-line pitches** (homepage = scale/transparency, `/how-it-works` = control, `/pricing` = automation-first, `/compare` = honesty/non-ranking) is a bigger creative direction call than the eight tasks below, and the homepage H1 is D250-locked — its own code comment says "do not edit casually." Rewriting four headlines to share one throughline needs your steer on _which_ thesis wins before anyone touches copy. Flagging it here rather than picking one for you. Once you have a direction, that becomes its own follow-up plan.

---

### Task 1: Fix two meta descriptions that overflow Google's display limit

**Files:**

- Modify: `apps/web/src/app/(marketing)/pricing/page.tsx:19-20`
- Modify: `apps/web/src/app/(marketing)/compare/page.tsx:15-16`
- Test: `apps/web/src/app/(marketing)/marketing-metadata.test.ts`

**Interfaces:**

- Consumes: `marketingPageMetadata()` from `apps/web/src/features/marketing/page-metadata.ts` (unchanged — this task only changes the `description` string each page passes in).
- Produces: nothing new is consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/app/(marketing)/marketing-metadata.test.ts` (alongside the existing per-page metadata tests — follow the file's existing import style for `pricingMetadata`/`compareMetadata`, whatever it currently imports the two `metadata` objects as):

```ts
describe("meta description length — stays inside Google's display limit", () => {
  it('keeps /pricing and /compare descriptions at 160 characters or fewer', () => {
    expect(pricing.description!.length).toBeLessThanOrEqual(160);
    expect(compare.description!.length).toBeLessThanOrEqual(160);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run marketing-metadata -t "display limit"`
Expected: FAIL — current lengths are 176 and 182.

- [ ] **Step 3: Fix the two descriptions**

In `apps/web/src/app/(marketing)/pricing/page.tsx`, replace:

```ts
  description:
    'Free includes manual sender cleanup, Plus removes the monthly limit and adds the Screener, Autopilot and Quiet hours, and Pro adds the Daily Brief, Follow-ups and more inboxes.',
```

with:

```ts
  description:
    'Free includes manual sender cleanup. Plus adds Screener, Autopilot and Quiet hours with no monthly limit. Pro adds the Daily Brief, Follow-ups and more inboxes.',
```

(160 characters — keeps every feature name the original had, just tightens the sentence structure.)

In `apps/web/src/app/(marketing)/compare/page.tsx`, replace:

```ts
  description:
    'DeclutrMail, Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail, side by side on what each actually does. Official sources, unknowns left unknown, no rankings.',
```

with:

```ts
  description:
    'DeclutrMail vs. Clean Email, Trimbox, SaneBox, Leave Me Alone, Unroll.Me and native Gmail — what each actually does. Official sources, unknowns left unknown.',
```

(157 characters. Drops "no rankings" from the description only — the page's H1 and badge still carry that claim; the meta description's job is the search snippet, not the full argument.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run marketing-metadata -t "display limit"`
Expected: PASS

- [ ] **Step 5: Run the full metadata test file to confirm nothing else broke**

Run: `pnpm --filter @declutrmail/web vitest run marketing-metadata`
Expected: PASS (the pinned-value tests for other pages are untouched, so they should still pass; if any test hardcoded the OLD /pricing or /compare description string, update that literal to match — see Self-Review note below).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(marketing\)/pricing/page.tsx apps/web/src/app/\(marketing\)/compare/page.tsx apps/web/src/app/\(marketing\)/marketing-metadata.test.ts
git commit -m "fix(marketing): shorten pricing/compare meta descriptions under 160 chars"
```

---

### Task 2: Disclose what happens when the Free monthly cleanup cap is hit

**Files:**

- Modify: `apps/web/src/features/marketing/pricing/pricing-screen.tsx:100-105`
- Test: `apps/web/src/features/marketing/pricing/pricing-screen.test.tsx`

**Interfaces:**

- Consumes: `TIER_MANIFEST.free.cleanupActionsPerMonth` (already imported transitively — the header paragraph is static JSX, not currently reading the manifest directly; this task keeps it static prose since the number "50" is already stated one line up via `cardBullets()` on the Free `TierCard`, so no new manifest read is needed here — just the _consequence_ sentence).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/marketing/pricing/pricing-screen.test.tsx` (match the file's existing render + query style — it already renders `<PricingScreen />` in other tests in this file):

```tsx
it('explains what happens when the Free monthly cap is reached', () => {
  render(<PricingScreen />);
  expect(screen.getByText(/until the next month or an upgrade/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run pricing-screen -t "monthly cap"`
Expected: FAIL — no such text exists yet.

- [ ] **Step 3: Add the consequence sentence**

In `apps/web/src/features/marketing/pricing/pricing-screen.tsx`, replace the header paragraph:

```tsx
          Free includes every manual cleanup action, with a monthly limit. Plus removes the limit
          and adds the Screener, Autopilot rules that keep working on their own, and Quiet hours.
          Pro adds the Daily Brief, Follow-ups, and more connected inboxes. Keep, Archive,
          Unsubscribe, Later, and Delete work the same way on every plan. {ACTION_SAFETY_SUMMARY}
```

with:

```tsx
          Free includes every manual cleanup action, with a monthly limit. Reaching the limit
          pauses Archive, Unsubscribe, Later, and Delete until the next month or an upgrade — Keep
          keeps working. Plus removes the limit and adds the Screener, Autopilot rules that keep
          working on their own, and Quiet hours. Pro adds the Daily Brief, Follow-ups, and more
          connected inboxes. Keep, Archive, Unsubscribe, Later, and Delete work the same way on
          every plan. {ACTION_SAFETY_SUMMARY}
```

(New middle sentence only. Wording matches the actual gate behavior: mutating verbs 402 with `FREE_CAP_REACHED` until the signup-anniversary reset or an upgrade; Keep is uncounted and unaffected — see `apps/web/src/lib/entitlements/upgrade-gate.ts:6-14` for the real gate this describes, so this task's copy has to keep matching that file if the gate logic ever changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run pricing-screen -t "monthly cap"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/pricing/pricing-screen.tsx apps/web/src/features/marketing/pricing/pricing-screen.test.tsx
git commit -m "fix(marketing): explain what happens at the Free monthly cap"
```

---

### Task 3: Disclose the Pro-only sender-filter action on the pricing comparison table

**Files:**

- Modify: `apps/web/src/features/marketing/pricing/pricing-model.ts` (add a selector row to `compareRows()`)
- Modify: `apps/web/src/features/marketing/pricing/pricing-model.test.ts:108-150` (update the row-count assertion, add a new test)

**Interfaces:**

- Consumes: `SELECTOR_TIERS` from `@declutrmail/shared/entitlements` — already re-exported at `packages/shared/src/entitlements/index.ts:8` (`export { COUNTS_AS_CLEANUP, SELECTOR_CAPS, SELECTOR_TIERS, TIER_MANIFEST } from './pricing.config';`). No barrel change needed for this task.
- Produces: `compareRows()` now returns one additional row, label `"All-matching cleanup"` — no other task depends on this row's exact position, only that `compareRows()` keeps returning `CompareRow[]` (unchanged type).

Label chosen to match, not invent: the identical `sender-filter` gate is already described in shipped in-app copy (`upgrade-modal.tsx`, `verb-constants.ts` comment) as "all-matching" / "All-matching actions are part of Pro" — using a third phrase here ("bulk by filter match") would give a user two different names for the same limit between the pricing page and the upgrade prompt they'd hit right after clicking it. This label also has to read clearly as distinct from ordinary multi-select bulk actions, which are Free.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/marketing/pricing/pricing-model.test.ts`, as the last test inside the existing `describe('compareRows — derived from the manifest', ...)` block (after `'quota rows read inboxLimit/undoWindowDays straight off the manifest'`):

```ts
it('discloses the Pro-only all-matching selector as its own row', () => {
  const rows = compareRows();
  const selectorRow = rows.find((r) => r.label === 'All-matching cleanup');
  expect(selectorRow).toBeDefined();
  const compareIds = TIER_IDS.filter((id) => TIER_MANIFEST[id].purchasable);
  expect(selectorRow?.values[compareIds.indexOf('free')]).toBeNull();
  expect(selectorRow?.values[compareIds.indexOf('plus')]).toBeNull();
  expect(selectorRow?.values[compareIds.indexOf('pro')]).toBe('Included');
});
```

Also update the row-count assertion in the block's **first** test (`'emits one row per LABEL plus quota rows...'`, currently `expect(rows).toHaveLength(distinctLabels.size + 2)`), since a new row changes the total:

```ts
// was: expect(rows).toHaveLength(distinctLabels.size + 2);
expect(rows).toHaveLength(distinctLabels.size + 3);
```

- [ ] **Step 2: Run tests to verify both fail**

Run: `pnpm --filter @declutrmail/web vitest run pricing-model -t "compareRows"`
Expected: the new "all-matching selector" test FAILs (`selectorRow` is `undefined`); the row-count test FAILs too (`distinctLabels.size + 2` no longer matches once bumped to `+3` ahead of the fix — if you'd rather see the _original_ count assertion fail first, edit that line in Step 3 alongside the implementation instead of here).

- [ ] **Step 3: Add the selector row to `compareRows()`**

In `apps/web/src/features/marketing/pricing/pricing-model.ts`, add the import:

```ts
import {
  CAPABILITIES,
  SELECTOR_TIERS,
  TIER_IDS,
  TIER_MANIFEST,
  type Capability,
  type PromoDefinition,
  type TierDefinition,
  type TierId,
} from '@declutrmail/shared/entitlements';
```

Then extend `compareRows()`'s return, adding a `selectorRows` array alongside the existing `quotaRows`:

```ts
const selectorRows: CompareRow[] = [
  {
    label: 'All-matching cleanup',
    values: tiers.map((tier) => (SELECTOR_TIERS['sender-filter'] === tier.id ? 'Included' : null)),
  },
];

return [...capabilityRows, ...quotaRows, ...selectorRows];
```

(`SELECTOR_TIERS['sender-filter']` is typed `ActionTier` — `'free' | 'plus' | 'pro'` — a proper subset of `tier.id`'s `TierId` type, and `compareRows()` only ever iterates `comparablePricingTiers()` (free/plus/pro), so the `===` comparison is both legal and correct at runtime, not just structurally similar. Today's value is `'pro'` per `pricing.config.ts:105` — comparing the tier's `id` rather than hardcoding a string means a re-tiering of the manifest value re-tiers this row automatically, matching every other row in this function.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/web vitest run pricing-model -t "compareRows"`
Expected: PASS

- [ ] **Step 5: Run the full pricing-model test file**

Run: `pnpm --filter @declutrmail/web vitest run pricing-model`
Expected: PASS — confirms `cardBullets()` and every other function in the file are unaffected (this task only touches `compareRows()`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/marketing/pricing/pricing-model.ts apps/web/src/features/marketing/pricing/pricing-model.test.ts
git commit -m "fix(pricing): disclose Pro-only all-matching selector in compare table"
```

---

### Task 4: Name the tier in the homepage hero subhead

**Files:**

- Modify: `apps/web/src/features/marketing/landing/hero.tsx:45-49`
- Test: `apps/web/src/app/(marketing)/page.test.tsx`

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing new consumed by later tasks. This task does **not** touch the H1 (`apps/web/src/features/marketing/landing/hero.tsx:42-43`) — that line is D250-locked per the file's own header comment ("do not edit casually"). Only the subhead paragraph changes, which the same comment explicitly says is where a Plus-only claim belongs, named.

- [ ] **Step 1: Write the failing test**

`page.test.tsx`'s other 13 tests all go through a local `renderLanding()` helper (`render(await LandingPage())`, with a fetch stub + `next/headers` mock) because `LandingPage` is an async Server Component — but `Hero` itself is a plain sync component with no data dependencies, so this test renders it directly instead, in its own `describe` block so the next reader doesn't mistake the different pattern for a mistake:

```tsx
import { Hero } from '@/features/marketing/landing/hero';

describe('Hero subhead — names the tier for a Plus-only claim', () => {
  it('names Plus when describing Autopilot rules (bypasses renderLanding — Hero has no server data dependency)', () => {
    render(<Hero />);
    const subhead = screen.getByText(/turn on a rule/i);
    expect(subhead.textContent).toMatch(/plus/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run page.test -t "names Plus"`
Expected: FAIL — the current subhead never says "Plus".

- [ ] **Step 3: Name the tier**

In `apps/web/src/features/marketing/landing/hero.tsx`, replace:

```tsx
<p className="dm-mkt-hero-sub dm-mkt-reveal-2 dm-mkt-reveal">
  One decision per sender clears thousands of emails at once — you see the count and the exact Gmail
  changes first. Turn on a rule and it keeps doing it, only after showing you what it would do.
</p>
```

with:

```tsx
<p className="dm-mkt-hero-sub dm-mkt-reveal-2 dm-mkt-reveal">
  One decision per sender clears thousands of emails at once — you see the count and the exact Gmail
  changes first. On Plus, turn on a rule and it keeps doing it, only after showing you what it would
  do.
</p>
```

(Minimal insertion — "On Plus, " — satisfying the file's own documented contract that Plus-only claims in the subhead must name the tier, without changing the sentence's shape or the free-signup CTA below it.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run page.test -t "names Plus"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/landing/hero.tsx apps/web/src/app/\(marketing\)/page.test.tsx
git commit -m "fix(marketing): name Plus in the hero's Autopilot subhead line"
```

---

### Task 5: Link the seven `/alternatives/*` pages from `/compare`

**Files:**

- Modify: `apps/web/src/features/marketing/comparison/comparison-screen.tsx` (add a new section to `ComparisonIndexScreen()`, after the existing card grid section, before `MatrixSection`)
- Test: `apps/web/src/features/marketing/comparison/comparison-screen.test.tsx`

**Interfaces:**

- Consumes: `ALTERNATIVES_SLUGS`, `comparisonBySlug` from `./comparison-data` (both already exported — `comparisonBySlug` at `comparison-data.ts:1162`, used to get each alternative's display `name` and `category` for the card).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/marketing/comparison/comparison-screen.test.tsx` (match its existing render style — it already renders `<ComparisonIndexScreen />` for other assertions in this file):

```tsx
it('links every /alternatives page from the compare index', () => {
  render(<ComparisonIndexScreen />);
  for (const slug of ALTERNATIVES_SLUGS) {
    const subject = comparisonBySlug(slug)!;
    expect(screen.getByRole('link', { name: `Alternatives to ${subject.name}` })).toHaveAttribute(
      'href',
      `/alternatives/${slug}`,
    );
  }
});
```

Add `ALTERNATIVES_SLUGS` and `ALTERNATIVES_SLUGS`'s companion type to the test file's **existing** import — it already has one, on the same directory level (do not add a new `../comparison-data` import; that path is wrong for a file that sits in the same folder as `comparison-data.ts`):

```ts
// was: import { COMPARISONS, comparisonBySlug } from './comparison-data';
import { ALTERNATIVES_SLUGS, COMPARISONS, comparisonBySlug } from './comparison-data';
```

(Deriving the expected label from `comparisonBySlug(slug)!.name` rather than transforming the slug avoids a real bug: `slug.replace('-', ' ')` is a non-global string replace, so `'leave-me-alone'` would become `'leave me-alone'`, not `'leave me alone'` — wrong for the one multi-hyphen slug in the set, and a test built the same way would pass while asserting that exact bug.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run comparison-screen -t "links every"`
Expected: FAIL — no `/alternatives/*` links exist on this page today.

- [ ] **Step 3: Add the alternatives section**

In `apps/web/src/features/marketing/comparison/comparison-screen.tsx`, add the import:

```ts
import {
  ALTERNATIVES_SLUGS,
  comparisonBySlug,
  COMPARISONS,
  COMPARISONS_VERIFIED_FLOOR_ISO,
  comparisonVerifiedLabel,
  ROUNDUP_DIMENSIONS,
  type ComparisonCell,
  type ComparisonDefinition,
  type EvidenceState,
} from './comparison-data';
```

Then add a new section inside `ComparisonIndexScreen()`, right after the closing `</section>` of the "Pick the closest alternative" card-grid section (the one containing `dm-compare-card-grid`) and before `<MatrixSection />`:

```tsx
<section
  className="dm-mkt-shell dm-compare-index-section"
  aria-labelledby="alternatives-list-title"
>
  <p className="dm-mkt-eyebrow">Looking for a roundup instead</p>
  <h2 id="alternatives-list-title" className="dm-mkt-h2">
    Every tool, from the other tool&rsquo;s side.
  </h2>
  <p className="dm-compare-matrix-lede">
    Each page below starts from a specific tool and lists what every alternative — including
    DeclutrMail — is actually for, using that tool&rsquo;s own words. No page ranks itself first.
  </p>
  <div className="dm-compare-card-grid">
    {ALTERNATIVES_SLUGS.map((slug) => {
      const subject = comparisonBySlug(slug);
      if (!subject) return null;
      return (
        <article className="dm-compare-card" key={slug}>
          <div className="dm-compare-card-topline">
            <span>{subject.category}</span>
          </div>
          <h3>Alternatives to {subject.name}</h3>
          <p>What to use instead of {subject.name}, and when to stay.</p>
          <a href={`/alternatives/${slug}`} aria-label={`Alternatives to ${subject.name}`}>
            See the alternatives <span aria-hidden="true">→</span>
          </a>
        </article>
      );
    })}
  </div>
</section>
```

(Reuses the exact `dm-compare-card` / `dm-compare-card-grid` classes the page already styles for the `/vs/*` grid above it — no new CSS.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run comparison-screen -t "links every"`
Expected: PASS

- [ ] **Step 5: Run the full comparison-screen test file**

Run: `pnpm --filter @declutrmail/web vitest run comparison-screen`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/marketing/comparison/comparison-screen.tsx apps/web/src/features/marketing/comparison/comparison-screen.test.tsx
git commit -m "fix(marketing): link /alternatives pages from the /compare index"
```

---

### Task 6: Explain Screener, Autopilot, Quiet, Brief, and Follow-ups on `/how-it-works`

**Files:**

- Modify: `apps/web/src/app/(marketing)/how-it-works/page.tsx` (add a new `StorySection` numbered `07`, before `FinalStoryCta`)
- Test: `apps/web/src/app/(marketing)/how-it-works/page.test.tsx`

**Interfaces:**

- Consumes: `StorySection` from `@/features/marketing/product-story` (already imported on this page — same component every other numbered section uses, so no new props are introduced beyond what `StorySection` already accepts: `id`, `number`, `title`, `intro`, optional `tone`, and children).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Write the failing test**

```tsx
it('names Screener, Autopilot, Quiet hours, Daily Brief, and Follow-ups before the final CTA', () => {
  render(<HowItWorksPage />);
  expect(screen.getByText(/screener/i)).toBeInTheDocument();
  expect(screen.getByText(/quiet hours/i)).toBeInTheDocument();
  expect(screen.getByText(/daily brief/i)).toBeInTheDocument();
  expect(screen.getByText(/follow-ups/i)).toBeInTheDocument();
});
```

(If `HowItWorksPage` is an async Server Component in this Next.js version and `render()` can't call it directly in the existing test file, follow whatever pattern `how-it-works/page.test.tsx` already uses for its other section-presence assertions — the file already tests this page's rendered output today, so match its existing render helper rather than introducing a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run how-it-works -t "names Screener"`
Expected: FAIL — none of those five terms appear on this page today.

- [ ] **Step 3: Add the new section**

In `apps/web/src/app/(marketing)/how-it-works/page.tsx`, insert a new `StorySection` between the `connect-boundary` section (`id="connect-boundary"`, number `"06"`) and `<FinalStoryCta`:

```tsx
<StorySection
  id="beyond-manual"
  number="07"
  title="Manual cleanup is the floor, not the whole product."
  intro={
    <p>
      Free covers everything above. Plus adds the Screener, which collects new senders for review
      instead of dropping them straight in your inbox, the whole Autopilot system for rules you turn
      on yourself, and Quiet hours, which decide when those rules are allowed to run. Pro adds the
      Daily Brief, a once-a-day summary of what actually needs your attention, and Follow-ups, a
      queue for the senders you replied to but haven&rsquo;t heard back from.
    </p>
  }
>
  <p className="dm-story-callout">
    See exactly what each plan includes on <a href="/pricing">the pricing page</a>.
  </p>
</StorySection>
```

(Numbered `07`, continuing the page's existing sequence. Uses only the `StorySection` props every other section on this page already uses — no new component, no new CSS class beyond `dm-story-callout`, which the `gmail-stays-home` section (`01`) already uses for the same "one supporting line" purpose.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run how-it-works -t "names Screener"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(marketing\)/how-it-works/page.tsx apps/web/src/app/\(marketing\)/how-it-works/page.test.tsx
git commit -m "feat(marketing): explain Screener/Autopilot/Quiet/Brief/Follow-ups on how-it-works"
```

---

### Task 7: Tighten Pro's one-line pitch in the pricing model

**Files:**

- Modify: `apps/web/src/features/marketing/pricing/pricing-model.ts:174-180`
- Test: `apps/web/src/features/marketing/pricing/pricing-model.test.ts`

**Interfaces:**

- Consumes: nothing new. `TIER_JOBS` stays `Readonly<Record<TierId, string>>` — same type, same five keys.
- Produces: `TierCard` and `NonPurchasableRow` both read `TIER_JOBS.pro` already; neither needs a code change, only the string value changes.

- [ ] **Step 1: Write the failing test**

`pricing-model.test.ts`'s existing import block does not include `TIER_JOBS` — add it:

```ts
// was: import { CAPABILITY_LABELS, cardBullets, compareRows, currencyForProvider,
//        formatInr, formatMoney, formatUsd, foundingProPromo, priceLineFor, pricingTiers } from './pricing-model';
import {
  CAPABILITY_LABELS,
  cardBullets,
  compareRows,
  currencyForProvider,
  formatInr,
  formatMoney,
  formatUsd,
  foundingProPromo,
  priceLineFor,
  pricingTiers,
  TIER_JOBS,
} from './pricing-model';
```

Then add a new `describe` block (`TIER_JOBS` isn't tested yet in this file):

```ts
describe('TIER_JOBS — one-line pitch per tier', () => {
  it('names a concrete Pro capability instead of restating the tagline', () => {
    expect(TIER_JOBS.pro).not.toBe('See what matters, across every account.');
    expect(TIER_JOBS.pro.toLowerCase()).toMatch(/brief|follow-up/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web vitest run pricing-model -t "concrete Pro capability"`
Expected: FAIL — current string is exactly `'See what matters, across every account.'`, which names neither term.

- [ ] **Step 3: Rewrite the string**

In `apps/web/src/features/marketing/pricing/pricing-model.ts`, replace:

```ts
  pro: 'See what matters, across every account.',
```

with:

```ts
  pro: 'Get a daily summary and follow-up nudges, across every account.',
```

(Matches the concreteness of its neighbor, `plus: 'Remove the monthly limit and let rules keep it clean.'` — names the two features Pro actually adds, Brief and Follow-ups, instead of a generic outcome phrase.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web vitest run pricing-model -t "concrete Pro capability"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/pricing/pricing-model.ts apps/web/src/features/marketing/pricing/pricing-model.test.ts
git commit -m "fix(pricing): make Pro's one-line pitch name a concrete capability"
```

---

### Task 8: Refresh every comparison entry tied at the stalest verification date

**Corrected scope.** The first draft of this task said "the two stalest" and named only `cleanEmail`/`trimbox`. That's wrong: six of the seven entries (`cleanEmail`, `trimbox`, `sanebox`, `leaveMeAlone`, `gmailFilters`, `gmailNative`) are tied at the exact same oldest date, `2026-07-11` — only `unrollMe` (`2026-08-13`) is fresher. `COMPARISONS_VERIFIED_FLOOR_ISO` — the date rendered on `/compare` and on every `/alternatives/*` page as "Last verified" — is the minimum across all seven. Refreshing only two of the six tied-oldest entries leaves the floor, and therefore the public-facing claim this task exists to fix, completely unchanged. This rescopes the task to all six.

**Files:**

- Modify: `apps/web/src/features/marketing/comparison/comparison-data.ts` (the `cleanEmail`, `trimbox`, `sanebox`, `leaveMeAlone`, `gmailFilters`, and `gmailNative` `ComparisonDefinition` objects — `verifiedIso` field, and any `unknown`-state cell a fresh check resolves)
- Test: `apps/web/src/features/marketing/comparison/comparison-data.test.ts` (existing suite — no new test needed, this task must keep it green)

**Interfaces:**

- Consumes: nothing new.
- Produces: nothing new. `COMPARISONS_VERIFIED_FLOOR_ISO` and `alternativesFor()`'s per-page `verifiedIso` both recompute automatically from whatever `verifiedIso` this task sets, per their existing "oldest of its children" logic in `comparison-data.ts:1157-1160` and `:1220-1225` — no code change needed there. **This is exactly why all six have to move, not just two: leave one entry at the old date and it alone still pins the floor.**

**This task is research, not a code change, and must not be done by guessing.** The existing test suite already enforces (per the competitive-claims review): ≥3 HTTPS sources per page, no bare "no" inferred from silence, and verification dates not in the future. Bumping `verifiedIso` without re-reading the source is the exact failure mode Tier 1b exists to catch — a false "verified" date is worse than the current honest-but-stale one. `gmailFilters`/`gmailNative` are Google's own docs, not a third-party vendor — check those too, since a stale Google Workspace Help page changes just as easily as a startup's pricing page.

- [ ] **Step 1: Re-read each of the six tied-oldest entries' current sources**

For `cleanEmail`, `trimbox`, `sanebox`, `leaveMeAlone`, `gmailFilters`, and `gmailNative` in turn: open every URL currently cited as a source for that entry. Note today's date. For each cell currently marked `state: 'unknown'`, check whether the page now states the fact plainly.

- [ ] **Step 2: Update `comparison-data.ts` only for what actually changed**

For each of the six:

- If a previously-`unknown` cell now has a stated answer, update its `state`, `summary`, and `detail` to match what the page says today, and add the URL to that entry's sources list if it isn't already there.
- If nothing changed, leave the cell as `unknown` — do **not** invent a state just to have something to show for the check.
- Either way, update `verifiedIso` to today's date, in the same `'YYYY-MM-DD'` format `unrollMe` already uses.

- [ ] **Step 3: Run the full comparison-data test suite**

Run: `pnpm --filter @declutrmail/web vitest run comparison-data`
Expected: PASS — the existing ≥3-sources-per-page and dates-not-in-the-future checks must still hold. If a newly-added source isn't HTTPS, or a cell you changed away from `unknown` now asserts a negative with no exact quote, the suite should catch it; fix the cell rather than the test.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/marketing/comparison/comparison-data.ts
git commit -m "chore(marketing): refresh the six comparison entries tied at the stalest verification date"
```

---

## Self-Review

**Spec coverage** — every finding from the audit that had a concrete fix (not a strategic judgment call) has a task:

| Audit finding                                                                            | Task                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pricing` and `/compare` meta descriptions overflow                                     | Task 1                                                                                                                                                                                                                                                                                                                                               |
| Free-cap consequence undisclosed                                                         | Task 2                                                                                                                                                                                                                                                                                                                                               |
| Pro-only sender-filter selector undisclosed                                              | Task 3                                                                                                                                                                                                                                                                                                                                               |
| Homepage subhead sells Plus-only automation under Free CTA                               | Task 4                                                                                                                                                                                                                                                                                                                                               |
| `/alternatives/*` pages have no click-path                                               | Task 5                                                                                                                                                                                                                                                                                                                                               |
| `/pricing` names 4 features `/how-it-works` never explains                               | Task 6                                                                                                                                                                                                                                                                                                                                               |
| Pro's one-line pitch is vague                                                            | Task 7                                                                                                                                                                                                                                                                                                                                               |
| Competitor verification dates ~7 weeks stale                                             | Task 8 (rescoped after adversarial review — see below)                                                                                                                                                                                                                                                                                               |
| Four inconsistent page-to-page positioning theses                                        | **Not scheduled** — needs your direction first, see note above the task list                                                                                                                                                                                                                                                                         |
| Three comparison formats, only one in the nav                                            | **Not scheduled** — Task 5 makes `/alternatives/*` reachable from `/compare`, which covers the actual dead-end; whether the nav itself should also list all three formats is a smaller follow-on, not bundled here since it's a nav-design call, not a content fix                                                                                   |
| "Sign in" / "Get started" / "Open beta" all resolve to one destination                   | **Not scheduled** — flagged as low-cost in the audit; no task proposed since three differently-labeled entry points to one OAuth start is arguably fine (it's how most SaaS sites frame a single signup for different visitor mindsets) and re-labeling any of them risks colliding with the sign-in QA run's own findings about that exact CTA pair |
| Stale doc-comment drift in `entitlements/types.ts` (says "2 inboxes/7d" vs actual 5/30d) | **Not scheduled** — source-of-truth prose only, doesn't render anywhere a user sees it; lowest priority in the audit and not worth its own task/PR cycle. Fold into Task 3's PR if the reviewer wants it, otherwise leave for a future doc-only pass                                                                                                 |

**Placeholder scan** — every step above has real code, a real file path, and a real assertion; no "TBD", no "add appropriate handling", no "similar to Task N" without the actual snippet repeated. Task 8 is intentionally research-only (it can't be pre-written, since the whole point is reading a live external page), but its steps say exactly what to check and what "done" looks like, not "figure it out."

**Type consistency** — `CompareRow` (Task 3) keeps its existing `{label: string, values: readonly (string|null)[]}` shape; no task changes its definition. `StorySection` (Task 6) is used with only the props the page's other six sections already pass it. `TIER_JOBS` (Task 7) keeps its existing `Readonly<Record<TierId, string>>` type — only one value changes.

---

## Adversarial review — what a first full read-through of every file caught

A counter-review agent read every file this plan touches in full (not the partial `grep` excerpts the first draft was built from) and reported 6 CONFIRMED defects, all fixed in the version of this plan above:

1. **Task 5's aria-label used a non-global `.replace('-', ' ')`** — silently mangles `'leave-me-alone'` into `'leave me-alone'`, and the plan's own proposed test asserted the same buggy transform, so it would have passed while shipping the bug. Fixed: both the component and its test now derive the label from `subject.name`, not the slug.
2. **Task 5's import instruction pointed at `../comparison-data`**, a path that doesn't exist from a test file in the same directory as the data module. Fixed to extend the file's real existing `./comparison-data` import.
3. **Task 4's test never imported `Hero`** and assumed a `render(<Hero />)` pattern the file has no precedent for (its 13 other tests all go through an async-Server-Component `renderLanding()` helper). Fixed: added the import and put the test in its own `describe` block with a comment explaining why it breaks from the file's usual pattern.
4. **Task 7's test referenced `TIER_JOBS` without adding it to the file's import list.** Fixed.
5. **Task 8's premise was wrong** — it named "the two stalest" entries, but six of seven are tied at the same oldest date, and the public "Last verified" floor is a minimum across all seven. Refreshing two of six would have left the floor, and the finding, unchanged. Rescoped to all six tied entries.
6. **PR-grouping bundled Task 7 into the "pure copy" group while splitting Task 3 into a separate PR — but both edit the same two files** (`pricing-model.ts`, `pricing-model.test.ts`), guaranteeing a rebase. Fixed below: Task 7 now rides with Task 2/3.

Two more were flagged and addressed even though they weren't outright breakages: Task 3's row label (`"Bulk cleanup by filter match"`) would have introduced a third name for a gate the in-app upgrade prompt already calls "all-matching" — renamed to `"All-matching cleanup"` to match. And Task 3's "update the row-count assertion two tests above it" was a miscounted pointer (it's actually the block's _first_ test) — corrected.

Verified as genuinely clean and left unchanged: Task 1's character counts, Task 2's replace block, Task 3's `SELECTOR_TIERS`/`TierId` type-comparison (looks like a type mismatch, isn't — `ActionTier` is a proper subset, and `compareRows()` never iterates outside it) and row-count math, Task 4's and Task 7's replace blocks, Task 5's already-exported data functions, Task 6's component/props/insertion-point, and every one of the "Not scheduled" calls.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-29-marketing-surface-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach? And, PR grouping (revised post-review): **Tasks 1, 4, 5, 6** as one PR — pure copy/IA fixes, no shared files, no judgment call left in them. **Tasks 2, 3, 7** as a second PR — all three are disclosure-of-behavior rather than pure copy, and 3+7 share `pricing-model.ts`/`pricing-model.test.ts` so they have to land together or in a fixed order anyway. **Task 8** last and alone — it's live external research, not a diff reviewable the same way as the other seven, and its six-entry scope means it's the slowest task by far.
