# Inbox Simulator — Plan 3: Engine-driven fixtures

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the demo's fixtures hand-writing what the engine decides. Verdicts, confidence and reasoning derive from `runCascade` + `renderTemplate`, so the public demo can never show a recommendation the real engine would not make. Then add the six adjacent `amazon.com` senders Plan 4's batch step needs.

**Architecture:** Fixtures become _seeds_ — display fields plus a `SenderSignals` object. A builder maps each seed through the engine at module init and returns a complete `TriageDecisionRow`, so every consumer's type is unchanged. A test pins each fixture's intended verdict, so an engine change that would silently rewrite the demo's story fails loudly instead.

**Tech Stack:** pnpm workspace, TypeScript 5.9, Vitest, Next.js 15, React 19.

## Global Constraints

- **Execution waits for [PR #646](https://github.com/CT2689-Tech/DeclutrMail/pull/646) to merge.** That PR edits `inbox-simulator-screen.tsx`; so does Task 3. Branch off `origin/main` _after_ it lands.
- `runCascade`, `renderTemplate` and `SenderSignals` come from `@declutrmail/shared/triage-engine` (landed on main in PR #643).
- Never run root `pnpm test` — it livelocks. Use `pnpm --filter <pkg> exec vitest run <path> --no-file-parallelism`.
- Never use `git commit --no-verify`. If husky rejects a commit for formatting, run `pnpm exec prettier --write <file>` and re-commit.
- **Do not change any existing fixture's `senderName`, `last90dMessages`, `totalAllTime` or `unsubscribeMethod`.** Stored v3 demo state validates against those four; changing one silently invalidates returning visitors' saved decisions. See "Why there is no storage bump" below.
- Canonical verbs are Keep · Archive · Unsubscribe · Later · Delete (D227). "Screen" is an internal enum, never user-facing.
- D222: DeclutrMail records verdicts, never predicted categories. `gmailCategory` is Gmail's own classification and stays an input, never an output.
- Commit subjects end `(D133)`.

## Two naming collisions to hold in your head

1. `TriageDecisionRow.signals: string[]` is **display copy** ("Read rate: 0% over the last 90 days"). `SenderSignals` is the **engine input struct**. They are unrelated. Name the new field `cascadeSignals` so a reader never conflates them.
2. `last90dMessages` is a display field and **not** a cascade input. `SenderSignals` has no 90-day message count — it takes `readRate90d`, `monthlyVolume`, `lastSeenDaysAgo` and `totalMessages`. Leave `last90dMessages` on the row.

## Why there is no storage bump

The four-plan sequence originally put a `v3 → v4` localStorage bump here. Checking the parser, it is not needed in this plan:

- `parsed.length > DEMO_ROWS.length` — growing 9 → 15 makes this strictly _more_ permissive.
- Decisions reference rows by `rowId`; all nine existing ids survive.
- The three value checks (`senderName`, `affectedCount` via `syntheticInboxCount`, and the `unsubscribeMethod === 'none'` + Unsubscribe rejection) all read fields this plan is forbidden to change.

So a returning visitor's saved decisions stay valid. The bump belongs to **Plan 4**, where batch decisions and a rule activation genuinely change the stored decision's shape. If you find yourself needing to change one of the four frozen fields, stop and report — that changes this conclusion.

---

### Task 1: Derive verdict, confidence and reasoning from the engine

**Files:**

- Modify: `apps/web/src/features/triage/data.ts`
- Create: `apps/web/src/features/triage/data.engine.test.ts`

**Interfaces:**

- Consumes: `runCascade`, `renderTemplate`, `type SenderSignals`, `type CascadeResult` from `@declutrmail/shared/triage-engine`.
- Produces: `TRIAGE_QUEUE: readonly TriageDecisionRow[]` — **unchanged type**, so no consumer changes. Plus an exported `TRIAGE_FIXTURE_SEEDS` for tests.

**The mapping.** `SenderSignals` needs fifteen fields. Six map from data the fixtures already carry, and `gmailCategory` maps **exactly** — `GmailCategory` and `SenderSignals['gmailCategory']` are both `'primary' | 'promotions' | 'social' | 'updates' | 'forums'`:

| `SenderSignals` field                                                                                                                   | Source                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `gmailCategory`                                                                                                                         | row's `gmailCategory`, identical union               |
| `readRate90d`                                                                                                                           | row's `readRate`                                     |
| `monthlyVolume`                                                                                                                         | row's `monthlyVolume`                                |
| `totalMessages`                                                                                                                         | row's `totalAllTime`                                 |
| `lastSeenDaysAgo`                                                                                                                       | row's `lastDays`                                     |
| `isProtected` / `protectionReason`                                                                                                      | row's `protectionReason` (`!== null`, and the value) |
| `unsubscribeChannel`                                                                                                                    | row's `unsubscribeMethod` — **see the null trap**    |
| `hasWrittenTo`, `starredInLastYear`, `firstSeenMonthsAgo`, `firstSeenDaysAgo`, `spikeRatio`, `isGovDomain`, `userManuallyArchivedCount` | **new — must be authored per fixture**               |

**The null trap.** `StoredUnsubscribeMethod` is `'one_click' | 'mailto' | 'none' | null`, where `null` means _the sender index has not derived a method yet_ (D248) — "not checked", which is NOT "no channel". `UnsubscribeChannel` has no null. Do **not** write `?? 'none'`: that makes the fixture claim we looked and found nothing. No current fixture uses `null`, so require a non-null method on seeds and let the type enforce it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/triage/data.engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { TRIAGE_QUEUE, TRIAGE_FIXTURE_SEEDS } from './data';

// The demo's guided story depends on these exact verdicts: Groupon is the
// reversible Archive lesson, LinkedIn the one-way Unsubscribe lesson, and
// Priya the Protected lesson. Pinning them here means a cascade change
// that would silently rewrite the public demo fails in CI instead.
const INTENDED_VERDICTS: Readonly<Record<string, string>> = {
  't-groupon': 'archive',
  't-linkedin': 'unsubscribe',
  't-oldnavy': 'archive',
  't-django': 'unsubscribe',
  't-nextdoor': 'archive',
  't-substack': 'later',
  't-sarah': 'keep',
  't-priya': 'keep',
  't-shipping': 'unsubscribe',
};

describe('triage fixtures — engine-derived', () => {
  it('derives every verdict from the cascade, matching the demo the copy describes', () => {
    for (const [id, verdict] of Object.entries(INTENDED_VERDICTS)) {
      const row = TRIAGE_QUEUE.find((r) => r.id === id);
      expect(row, `fixture ${id} missing`).toBeDefined();
      expect(row!.verdict, `fixture ${id}`).toBe(verdict);
    }
  });

  it('derives reasoning from the template, never hand-written prose', () => {
    for (const row of TRIAGE_QUEUE) {
      expect(row.reasoning.length).toBeGreaterThan(0);
      // renderTemplate always names the sender. A hand-written string that
      // forgot to would slip through any length check.
      expect(row.reasoning).toContain(row.senderName);
    }
  });

  it('carries a confidence the cascade produced, in range', () => {
    for (const row of TRIAGE_QUEUE) {
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('has one seed per row, so nothing is hand-written alongside', () => {
    expect(TRIAGE_FIXTURE_SEEDS.length).toBe(TRIAGE_QUEUE.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage/data.engine.test.ts --no-file-parallelism`
Expected: FAIL — `TRIAGE_FIXTURE_SEEDS` is not exported.

- [ ] **Step 3: Introduce the seed type and the builder**

In `data.ts`, above the fixtures:

```ts
import { renderTemplate, runCascade, type SenderSignals } from '@declutrmail/shared/triage-engine';

/**
 * A fixture before the engine runs: everything the row displays, minus
 * the three fields the cascade decides, plus the signals it decides from.
 *
 * `verdict`, `confidence` and `reasoning` used to be hand-written here.
 * That let the public demo show a recommendation the real engine would
 * never make, and it meant an engine change updated the product while the
 * demo went on describing the old behaviour (D133). Deriving them makes
 * that drift impossible by construction.
 *
 * `cascadeSignals` is deliberately NOT called `signals` — the row already
 * has a `signals: string[]` of display copy, and the two are unrelated.
 */
export type TriageFixtureSeed = Omit<
  TriageDecisionRow,
  'verdict' | 'confidence' | 'reasoning' | 'unsubscribeMethod'
> & {
  /**
   * Non-null on purpose. The wire type allows `null` for "the sender index
   * has not derived a method yet" (D248), which is NOT "no channel" — and
   * `SenderSignals.unsubscribeChannel` has no way to say "unknown". A
   * fixture that mapped null to `'none'` would claim we looked.
   */
  unsubscribeMethod: UnsubscribeMethod;
  cascadeSignals: SenderSignals;
};

function buildFixtureRow(seed: TriageFixtureSeed): TriageDecisionRow {
  const { cascadeSignals, ...display } = seed;
  const result = runCascade(cascadeSignals);
  return {
    ...display,
    verdict: result.verdict,
    confidence: result.confidence,
    reasoning: renderTemplate(seed.senderName, result),
  };
}
```

Then convert each of the nine existing fixtures: move it into a `TRIAGE_FIXTURE_SEEDS` array, delete its `verdict` / `confidence` / `reasoning` properties, and add `cascadeSignals`. Worked example — `t-groupon`, which must stay `archive`:

```ts
  {
    id: 't-groupon',
    senderId: '…',            // unchanged
    senderKey: '…',           // unchanged
    senderName: 'Groupon',    // FROZEN — see Global Constraints
    senderEmail: 'noreply@groupon.com',
    senderDomain: 'groupon.com',
    brandMark: true,
    gmailCategory: 'promotions',
    unsubscribeMethod: 'one_click',   // FROZEN
    // verdict / confidence / reasoning DELETED — the engine decides them
    signals: [ /* display copy, unchanged */ ],
    protectionReason: null,
    monthlyVolume: 52,
    readRate: 0,
    lastDays: 0,
    last90dMessages: 156,     // FROZEN
    totalAllTime: 1700,       // FROZEN
    cascadeSignals: {
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0,          // ← mirrors `readRate`
      firstSeenMonthsAgo: 30,
      firstSeenDaysAgo: 900,
      lastSeenDaysAgo: 0,      // ← mirrors `lastDays`
      totalMessages: 1700,     // ← mirrors `totalAllTime`
      monthlyVolume: 52,       // ← mirrors `monthlyVolume`
      spikeRatio: 3,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    },
  },
```

The mirrored fields matter beyond tidiness: the row's stat block and its generated reasoning both read from these numbers, so a mismatch shows up on screen as a row whose explanation contradicts its own stats. The seven unmirrored fields are yours to choose — pick values that land the intended rule.

Finally:

```ts
export const TRIAGE_QUEUE: readonly TriageDecisionRow[] = TRIAGE_FIXTURE_SEEDS.map(buildFixtureRow);
```

**Author the signals backwards.** For each fixture, pick the intended verdict from `INTENDED_VERDICTS`, then choose signal values that make the cascade emit it. Read `packages/shared/src/triage-engine/cascade.ts` to see which rule fires for which inputs — the Phase A protect rules, the Phase B rules, and the Phase C scoring. Reuse the row's existing display numbers wherever they map (that keeps the row's stats and its reasoning consistent), and choose the seven new fields to land on the intended rule.

**If a fixture will not produce its intended verdict**, do not fudge the test. Report it — either the intended verdict was never what the engine would say (which is the drift this plan exists to expose, and the founder should hear about it), or the signals need more work.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage/data.engine.test.ts --no-file-parallelism`
Expected: PASS, 4 cases.

- [ ] **Step 5: Run every suite that consumes the fixtures**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage src/features/marketing --no-file-parallelism`
Expected: PASS.

Existing tests assert on the reasoning strings the fixtures used to hand-write. Those strings now come from `renderTemplate`, so some will differ. For each failure decide honestly: if the template's output is correct and the old assertion pinned hand-written prose, update the assertion; if the template's output is _wrong_ for that fixture, the signals are wrong — fix the signals, not the test. **Name every assertion you changed and which of the two cases it was.**

- [ ] **Step 6: Negative control**

Pick one fixture and change one `cascadeSignals` value enough to flip its verdict (e.g. give `t-groupon` a `readRate90d` of `0.95`).

Run the Step 4 command. Expected: FAIL on that fixture's intended verdict.

**Restore, and confirm `git diff` is empty for `data.ts` before continuing.** This proves the verdicts are computed, not copied.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/triage
git commit -m "feat(triage): derive demo fixture verdicts from the engine (D133)"
```

---

### Task 2: Add the six adjacent amazon.com senders

**Files:**

- Modify: `apps/web/src/features/triage/data.ts`
- Create: `apps/web/src/features/triage/data.domain-batch.test.ts`

**Interfaces:**

- Consumes: `TRIAGE_QUEUE` from Task 1; `findDomainBatches`, `MIN_BATCH_RUN` from `./domain-batch`.
- Produces: six new seeds in `TRIAGE_FIXTURE_SEEDS`, contiguous, sharing `amazon.com`.

**What makes the batch appear.** `findDomainBatches` walks runs of **consecutive** rows sharing a registrable domain, and requires `eligibleRows.length >= MIN_BATCH_RUN` where `MIN_BATCH_RUN = 3`. Eligibility is `row.protectionReason === null` — **protection only, not verdict**. So six adjacent senders with one Protected leaves five eligible, which clears the threshold, and the five may carry different recommendations. That is what makes Plan 4's step 1 possible: the engine visibly disagreeing with itself while one decision covers them all.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/triage/data.domain-batch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { TRIAGE_QUEUE } from './data';
import { MIN_BATCH_RUN, findDomainBatches } from './domain-batch';

describe('amazon.com domain batch — Plan 4 step 1', () => {
  const batch = findDomainBatches(TRIAGE_QUEUE).find((b) => b.domain === 'amazon.com');

  it('forms a batch', () => {
    expect(batch).toBeDefined();
  });

  it('carries six senders, five of them actionable', () => {
    expect(batch!.rows.length).toBe(6);
    expect(batch!.eligibleRows.length).toBe(5);
    expect(batch!.eligibleRows.length).toBeGreaterThanOrEqual(MIN_BATCH_RUN);
  });

  it('excludes the protected sender from the actionable set', () => {
    const protectedRows = batch!.rows.filter((r) => r.protectionReason !== null);
    expect(protectedRows.length).toBe(1);
    expect(batch!.eligibleRows).not.toContainEqual(protectedRows[0]);
  });

  it('shows the engine disagreeing — the batch is not one verdict repeated', () => {
    const verdicts = new Set(batch!.eligibleRows.map((r) => r.verdict));
    expect(verdicts.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage/data.domain-batch.test.ts --no-file-parallelism`
Expected: FAIL — no `amazon.com` batch exists.

- [ ] **Step 3: Add the six seeds**

Insert six contiguous seeds into `TRIAGE_FIXTURE_SEEDS`, all with `senderDomain: 'amazon.com'`. Target shape — author `cascadeSignals` backwards to reach each verdict, as in Task 1:

| Sender                  | Intended verdict | Note                                     |
| ----------------------- | ---------------- | ---------------------------------------- |
| Amazon.com              | archive          | the bulk of the volume                   |
| Amazon Prime Video      | archive          |                                          |
| Amazon Advertising      | unsubscribe      | the disagreement                         |
| Amazon Orders           | later            | the second disagreement                  |
| Amazon Photos           | archive          |                                          |
| Amazon Account Security | keep             | `protectionReason` set — the skipped one |

Give each a distinct `id`, `senderId`, `senderKey`, `senderEmail`, and realistic display stats, following the Task 1 worked example's shape. The Protected one needs `protectionReason` set to one of `'manual' | 'replied' | 'starred' | 'gmail-important'` — use `'gmail-important'`, which is the honest reason for a security-notification sender and exercises a different protect rule than `t-priya`'s `'replied'`.

Follow the existing fixtures' style for the doc comments — this file explains _why_ each fixture exists, not just what it holds. Say plainly that this run exists to give Plan 4's batch step a mixed-recommendation card, so a later reader does not "tidy" the disagreement away.

Add the intended verdicts to `INTENDED_VERDICTS` in `data.engine.test.ts` so Task 1's pin covers them too.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage --no-file-parallelism`
Expected: PASS, including Task 1's verdict pin now covering fifteen fixtures.

- [ ] **Step 5: Confirm the frozen fields are untouched**

```bash
git diff apps/web/src/features/triage/data.ts | grep -E "^-.*(senderName|last90dMessages|totalAllTime|unsubscribeMethod):"
```

Expected: **empty**. Any removed line here means an existing fixture's storage-validated field changed, which silently invalidates returning visitors' saved decisions. If it is not empty, stop and report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/triage
git commit -m "feat(triage): add the amazon.com demo batch fixtures (D133)"
```

---

### Task 3: Confirm the demo still works end to end

**Files:**

- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.test.tsx` (only if an assertion legitimately moved)

**Interfaces:** none — this task adds no production code.

The simulator renders all fixtures in Explore mode and three of them in guided mode. Fifteen rows instead of nine changes what "explore all senders" means, and the mode-toggle button text names the count.

- [ ] **Step 1: Run the simulator's suite**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: PASS, or a failure that names the row count.

The button reads `Explore all ${DEMO_ROWS.length} senders`. If a test pins "9", update it to derive from `TRIAGE_QUEUE.length` rather than pinning "15" — a pinned number here is the same defect class this whole sequence is removing.

- [ ] **Step 2: Smoke it in a browser**

```bash
pnpm --filter @declutrmail/web dev
```

At `/inbox-simulator`, verify:

- the three guided steps still read correctly, and their senders still carry the recommendations their copy describes ("Try Archive — the highlighted decision" must still sit on a row the engine recommends Archive for)
- Explore mode lists fifteen senders and the toggle names fifteen
- the reasoning copy on each row reads as product prose, not as a template artefact with a doubled space or a missing clause
- no console errors

Reasoning strings are now generated, so **read several of them**. A template that renders "Groupon sends 52/mo. ." for some signal combination will pass every test in this plan and look broken to a visitor.

- [ ] **Step 3: Commit any test adjustment**

```bash
git add apps/web/src/features/marketing/inbox-simulator
git commit -m "test(marketing): derive the simulator row count from the fixtures (D133)"
```

If nothing needed changing, skip the commit and say so.

---

## Done when

- [ ] No fixture hand-writes `verdict`, `confidence` or `reasoning`.
- [ ] The verdict pin covers all fifteen fixtures and was watched failing under a deliberately altered signal, then restored.
- [ ] `findDomainBatches` yields an `amazon.com` batch of six with five eligible and more than one verdict among them.
- [ ] No existing fixture's `senderName`, `last90dMessages`, `totalAllTime` or `unsubscribeMethod` changed.
- [ ] Generated reasoning was read on screen, not just asserted on.
- [ ] `pnpm --filter @declutrmail/web exec vitest run --no-file-parallelism` green; `pnpm typecheck` clean.
