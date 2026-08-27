# Inbox Simulator — Plan 2: Copy truth

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the product hedging about a guarantee it actually makes. Undo is 30 days on every tier; nine shipped copy sites still say "your plan's Undo window". Fix them by deriving from the manifest, so the copy can never drift from packaging again — plus two smaller demo-copy corrections.

**Architecture:** One derived constant (`UNIFORM_UNDO_WINDOW_DAYS`) in `packages/shared/src/entitlements`, `null` when tiers diverge. Four of the nine sites collapse into a single function change because every action-preview surface renders through `buildActionPresentation`. The demo's plan strip stops hand-writing tier features and reads the `CAPABILITY_LABELS` record that already exists.

**Tech Stack:** pnpm workspace, TypeScript 5.9, Vitest, Next.js 15, React 19.

## Global Constraints

- **Branch off `origin/main`, NOT off `feat/d133-inbox-simulator-scale`.** Plan 2 has no dependency on Plan 1, and branching off it would make this PR re-propose Plan 1's whole diff.
- Never run root `pnpm test` — it livelocks. Use `pnpm --filter <pkg> exec vitest run <path> --no-file-parallelism`.
- Never use `git commit --no-verify`. Husky runs prettier on staged files; if a commit is rejected, run `pnpm exec prettier --write <file>` and re-commit.
- **Never hardcode `30`.** The whole point is that the number comes from `TIER_MANIFEST`. A literal `30` in copy re-creates the defect this plan removes.
- Canonical verbs are **Keep · Archive · Unsubscribe · Later · Delete** (D227). "Screen" is an internal enum and must never appear in product UI.
- The trust-badge claim is `We never fetch or store full email contents.` Counter-style claims ("Bodies read: 0") are banned by CLAUDE.md §2.1.
- Commit subjects end `(D245)`.

## The nine sites

| #   | File                                                              | Current phrasing                           | Task                 |
| --- | ----------------------------------------------------------------- | ------------------------------------------ | -------------------- |
| 1-4 | `packages/shared/src/actions/action-semantics.ts:115,142,192,214` | "during your plan's Undo window"           | 1 (one function)     |
| 5   | `packages/shared/src/shell/app-shell.tsx:20`                      | "use your plan's Activity Undo window"     | 2                    |
| 6   | `packages/shared/src/contracts/gmail-data-inventory.ts:20`        | "Until the plan-based Undo window expires" | 2 — **see the flag** |
| 7   | `apps/web/src/features/triage/batch-action-sheet.tsx:260`         | "during your plan's Activity window"       | 3                    |
| 8   | `apps/web/src/features/triage/action-sheet.tsx:389`               | "uses your plan's Activity undo window"    | 3                    |
| 9   | `apps/web/src/features/triage/action-sheet.tsx:392`               | "Activity Undo uses your plan's window"    | 3                    |

Already correct, and the precedent to follow: `apps/web/src/features/settings/privacy-data/privacy-data-screen.tsx:206` renders `{MIN_UNDO_WINDOW_DAYS}`.

> **FOUNDER FLAG — site 6.** `gmail-data-inventory.ts` is the D245 Gmail-data lifecycle registry and generates the public storage list. CLAUDE.md §9 lists "privacy / data retention behavior (retention windows)" as a stop condition. This change is **copy-only**: the retention window is 30 days before and after, and the edit makes the registry _more_ precise. No behavior, schema, or retention period changes. Raised here rather than at merge. If the founder would rather this one site move to its own change, drop it from Task 2 and leave it stale — the other eight still stand on their own.

---

### Task 1: Derive the undo window, and fix four sites with one function

**Files:**

- Create: `packages/shared/src/entitlements/undo-window.ts`
- Modify: `packages/shared/src/entitlements/index.ts`
- Modify: `packages/shared/src/actions/action-semantics.ts` (the `presentationActivityUndo` function, ~line 471)
- Create: `packages/shared/src/entitlements/undo-window.test.ts`
- Modify: `packages/shared/src/actions/action-semantics.test.ts` if it asserts the old string

**Interfaces:**

- Consumes: `MIN_UNDO_WINDOW_DAYS`, `MAX_UNDO_WINDOW_DAYS` from `packages/shared/src/entitlements/resolve.ts` (both already exported).
- Produces: `UNIFORM_UNDO_WINDOW_DAYS: number | null` from `@declutrmail/shared/entitlements`. Tasks 2 and 3 import it.

**Why one function covers four sites:** every action-preview surface (`action-preview-presentation`, `batch-action-sheet`, `decide-preview`, `snoozed-screen`, `activate-rule-modal`, `approve-confirm-modal`, `confirm-action-modal`) renders through `buildActionPresentation`, which routes the undo line through `presentationActivityUndo`. The four static `summary` strings in `ACTION_SEMANTICS` become the fallback-of-last-resort, used only if tiers ever diverge again.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/entitlements/undo-window.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { TIER_MANIFEST } from './pricing.config';
import { TIER_IDS } from './types';
import { UNIFORM_UNDO_WINDOW_DAYS } from './undo-window';

describe('UNIFORM_UNDO_WINDOW_DAYS', () => {
  it('is the shared window when every tier agrees, and null when they do not', () => {
    const windows = TIER_IDS.map((id) => TIER_MANIFEST[id].undoWindowDays);
    const allEqual = windows.every((d) => d === windows[0]);

    // Derived, not asserted: this test states the RULE, so it keeps
    // holding when the ladder changes. Pinning the literal 30 here would
    // re-create the drift the constant exists to prevent.
    expect(UNIFORM_UNDO_WINDOW_DAYS).toBe(allEqual ? windows[0] : null);
  });

  it('is a positive whole number of days whenever it is not null', () => {
    if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
    expect(Number.isSafeInteger(UNIFORM_UNDO_WINDOW_DAYS)).toBe(true);
    expect(UNIFORM_UNDO_WINDOW_DAYS).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/entitlements/undo-window.test.ts --no-file-parallelism`
Expected: FAIL — cannot resolve `./undo-window`.

- [ ] **Step 3: Write the constant**

Create `packages/shared/src/entitlements/undo-window.ts`:

```ts
import { MAX_UNDO_WINDOW_DAYS, MIN_UNDO_WINDOW_DAYS } from './resolve';

/**
 * The Activity Undo window in days when every tier grants the same one,
 * or `null` when the ladder diverges.
 *
 * Copy asks this before it phrases anything. While it is a number, a
 * surface can promise "30 days" outright; while it is `null`, the honest
 * phrasing is plan-dependent because the answer genuinely varies.
 *
 * This exists because the ladder went uniform on 2026-08-23 (undo 7d → 30d
 * on every tier) and nine shipped copy sites went on hedging — "your
 * plan's Undo window" — about a variance that no longer existed, while the
 * marketing hero already promised "30-day undo". A user reading the hedge
 * mid-Delete has to go look up a number the product knows.
 *
 * Deriving rather than hardcoding is the point: if a future packaging
 * change re-splits the window, every consumer degrades to the accurate
 * plan-dependent wording with no copy edit.
 */
export const UNIFORM_UNDO_WINDOW_DAYS: number | null =
  MIN_UNDO_WINDOW_DAYS === MAX_UNDO_WINDOW_DAYS ? MIN_UNDO_WINDOW_DAYS : null;
```

Export it from `packages/shared/src/entitlements/index.ts` beside `MIN_UNDO_WINDOW_DAYS`:

```ts
export { UNIFORM_UNDO_WINDOW_DAYS } from './undo-window';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/entitlements/undo-window.test.ts --no-file-parallelism`
Expected: PASS, both cases.

- [ ] **Step 5: Route the four action-semantics sites through it**

In `packages/shared/src/actions/action-semantics.ts`, import the constant and change ONLY `presentationActivityUndo`:

```ts
function presentationActivityUndo(
  semantics: ActionSemantics,
  deadline: string | null,
): ActionPresentationActivityUndo {
  if (semantics.activityUndo.kind === 'none') {
    return { kind: 'none', deadline: null, summary: semantics.activityUndo.summary };
  }
  // A real deadline always wins — it is the exact answer for THIS action.
  if (deadline !== null) {
    return {
      kind: 'plan-window',
      deadline,
      summary: `Undo from Activity until ${formatIsoUtc(deadline)}.`,
    };
  }
  // No deadline yet (every preview, before the mutation runs). While the
  // ladder is uniform we can still state the window instead of hedging.
  if (UNIFORM_UNDO_WINDOW_DAYS !== null) {
    return {
      kind: 'plan-window',
      deadline: null,
      summary: `Undo from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days.`,
    };
  }
  return { kind: 'plan-window', deadline: null, summary: semantics.activityUndo.summary };
}
```

Leave the four static `summary` strings in `ACTION_SEMANTICS` exactly as they are — they are now the divergent-ladder fallback and are correct for that case.

- [ ] **Step 6: Run the shared suite**

Run: `pnpm --filter @declutrmail/shared exec vitest run --no-file-parallelism`
Expected: PASS. If a test asserts the old preview string, update that assertion — the string genuinely changed and the test is asserting the defect. Say so in your report, naming each assertion you changed and why.

- [ ] **Step 7: Negative control**

Temporarily edit `packages/shared/src/entitlements/pricing.config.ts` to give ONE tier `undoWindowDays: 7`.

Run: `pnpm --filter @declutrmail/shared exec vitest run src/entitlements/undo-window.test.ts --no-file-parallelism`
Expected: PASS — the test states the rule, so it still holds. Then confirm `UNIFORM_UNDO_WINDOW_DAYS` is now `null` and the preview copy falls back to the plan-dependent wording, with a scratch check:

```bash
pnpm --filter @declutrmail/shared exec tsx -e "import('./src/entitlements/undo-window.ts').then(m => console.log('UNIFORM =', m.UNIFORM_UNDO_WINDOW_DAYS))"
```

Expected: `UNIFORM = null`.

**Restore `pricing.config.ts` and re-run to confirm it returns to the uniform value.** This is the control that proves the derivation is real and not a dressed-up constant.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/entitlements packages/shared/src/actions
git commit -m "fix(copy): state the undo window instead of hedging (D245)"
```

---

### Task 2: The two remaining shared strings

**Files:**

- Modify: `packages/shared/src/shell/app-shell.tsx:14,20`
- Modify: `packages/shared/src/contracts/gmail-data-inventory.ts:20`

**Interfaces:**

- Consumes: `UNIFORM_UNDO_WINDOW_DAYS` from Task 1.
- Produces: nothing new.

Read the FOUNDER FLAG above before touching `gmail-data-inventory.ts`. If the founder has said to defer it, do only `app-shell.tsx` and note the omission in your report.

- [ ] **Step 1: Export the claim list, then write the failing test**

`TRUST_CLAIMS` at `packages/shared/src/shell/app-shell.tsx:10` is a module-level
`const` and is **not** exported, so its copy has no test today. Export it — that
is the whole change, no restructuring:

```ts
export const TRUST_CLAIMS = [
```

Then create `packages/shared/src/shell/app-shell.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { UNIFORM_UNDO_WINDOW_DAYS } from '../entitlements';
import { TRUST_CLAIMS } from './app-shell';

describe('shell trust claims — undo windows', () => {
  it('states the window when the ladder is uniform, and never hedges past it', () => {
    const entry = TRUST_CLAIMS.find((e) => e.label === 'Undo windows');
    expect(entry).toBeDefined();
    if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
    expect(entry!.title).toContain(`${UNIFORM_UNDO_WINDOW_DAYS} days`);
    expect(entry!.title).not.toMatch(/your plan's Activity Undo window/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/shell --no-file-parallelism`
Expected: FAIL on the `not.toMatch` — the current string contains exactly that phrase.

- [ ] **Step 3: Rewrite both strings**

`app-shell.tsx` — the entry becomes a derived template. Keep the Gmail-Trash and unsubscribe clauses unchanged; only the Activity-Undo clause moves:

```ts
  {
    label: 'Undo windows',
    destination: 'activity',
    title:
      UNIFORM_UNDO_WINDOW_DAYS === null
        ? "Archive, Later, and Delete use your plan's Activity Undo window. Gmail Trash recovery is separate and normally lasts up to 30 days. Delivered unsubscribe requests can't be recalled."
        : `Archive, Later, and Delete can be undone from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days. Gmail Trash recovery is separate and normally lasts up to 30 days. Delivered unsubscribe requests can't be recalled.`,
  },
```

Note the two 30s in that sentence are different facts — the Activity window and Gmail's Trash retention. Only the first is ours to derive; Gmail's is Google's and stays a literal. Update the code comment at `:14` to say so, because a later reader will otherwise "helpfully" derive both.

`gmail-data-inventory.ts` — the retention line:

```ts
  undoJournal:
    UNIFORM_UNDO_WINDOW_DAYS === null
      ? 'Until the plan-based Undo window expires, followed by the operational cleanup period.'
      : `Until the ${UNIFORM_UNDO_WINDOW_DAYS}-day Undo window expires, followed by the operational cleanup period.`,
```

If that object is declared `as const`, a computed value will break the const assertion. In that case widen just this property's type or lift the expression above the object — do NOT drop `as const` from the whole registry, which other code depends on for literal types.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/shared exec vitest run --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Update the one asserting test in web**

`apps/web/src/features/settings/privacy-data/privacy-data-screen.test.tsx:111` asserts `/Delete also uses your plan's Activity Undo window/i`. Read that screen's source around the assertion, update the assertion to match the new derived copy, and keep it deriving — assert against `UNIFORM_UNDO_WINDOW_DAYS`, not a literal `30`.

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/settings/privacy-data --no-file-parallelism`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/shell packages/shared/src/contracts apps/web/src/features/settings
git commit -m "fix(copy): derive the undo window in shell and retention copy (D245)"
```

---

### Task 3: The three web strings

**Files:**

- Modify: `apps/web/src/features/triage/batch-action-sheet.tsx:260`
- Modify: `apps/web/src/features/triage/action-sheet.tsx:389,392`

**Interfaces:**

- Consumes: `UNIFORM_UNDO_WINDOW_DAYS` from Task 1.
- Produces: nothing new.

These are inline JSX ternaries, not table entries. Read each in context first — each sits inside a larger conditional about which verb is pending, and the surrounding branches must not change.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/triage/action-sheet.test.tsx`:

This file renders with `renderToStaticMarkup` and asserts on the HTML string —
match that style, not jsdom queries. `row` is already defined at module scope as
`TRIAGE_QUEUE[0]!`. Add:

```tsx
import { UNIFORM_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';

it('states the undo window on a Delete sheet instead of hedging', () => {
  const html = renderToStaticMarkup(
    <ActionSheet
      open={true}
      verb="Delete"
      row={row}
      inboxCount={2}
      mailboxEmail="active@gmail.com"
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(html).not.toContain("your plan's window");
  if (UNIFORM_UNDO_WINDOW_DAYS === null) return;
  expect(html).toContain(`${UNIFORM_UNDO_WINDOW_DAYS} days`);
});
```

Note the assertion order: the `not.toContain` runs unconditionally, so the test
still guards against the hedge even if the ladder diverges later and the second
assertion is skipped.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage/action-sheet.test.tsx --no-file-parallelism`
Expected: FAIL — the sheet still renders "uses your plan's window".

- [ ] **Step 3: Rewrite the three strings**

Each follows the same shape as Task 2: `UNIFORM_UNDO_WINDOW_DAYS === null ? <existing string> : <derived string>`. Keep every other clause identical — in particular `action-sheet.tsx:392`'s Gmail-Trash clause ("Gmail normally keeps Trash for up to 30 days") is Google's retention, not ours, and stays a literal.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Sweep for anything missed**

```bash
grep -rn "your plan's\|plan-based Undo\|plan Activity Undo\|plan's Activity" packages/shared/src apps/web/src | grep -v "\.test\." | grep -vi "pricing\|tier-card\|compare-table"
```

Expected: only the divergent-ladder fallback branches you deliberately kept. Name each remaining hit in your report and say why it stays. A hit you cannot justify is a site you missed.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/triage
git commit -m "fix(copy): state the undo window on triage sheets (D245)"
```

---

### Task 4: The simulator's inconsistent CTA

**Files:**

- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:534`

**Interfaces:** none.

The page's closing CTA reads `Connect Gmail →` while its own completion block already reads `Review my Gmail senders →`. One page, two labels for the same action. The standard is the latter.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.test.tsx`:

```tsx
it('uses one label for the connect action', () => {
  render(<InboxSimulatorScreen />);
  expect(screen.queryByText(/^Connect Gmail/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/Review my Gmail senders/).length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: FAIL — `Connect Gmail →` is present.

- [ ] **Step 3: Change the label**

Replace `Connect Gmail →` with `Review my Gmail senders →`. Change nothing else about that `TrackedCta` — its `href`, `cta` and `placement` props feed analytics and must stay.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/inbox-simulator
git commit -m "fix(marketing): one label for the simulator connect action (D245)"
```

---

### Task 5: Derive the plan strip instead of hand-writing it

**Files:**

- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx:659-672`
- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.test.tsx`

**Interfaces:**

- Consumes: `CAPABILITY_LABELS` (an exported, total `Readonly<Record<Capability, string>>`) and `PRICING_TIER_ORDER` from `@/features/marketing/pricing/pricing-model`; `TIER_MANIFEST` from `@declutrmail/shared/entitlements`.
- Produces: nothing new.

**The bug:** the strip hand-writes `Plus → "Rules keep it clean for you"`. That names Autopilot only. Plus actually adds **three** capabilities — `screener`, `autopilot` (+`autopilot-active`) and `quiet` — so Screener and Quiet hours are simply missing from the page that compares plans. Pro's line happens to be right today, which is luck, not correctness.

`CAPABILITY_LABELS` already exists and is already total, so an unlabelled capability is already a compile error. Nothing new needs building — the strip just has to read it.

- [ ] **Step 1: Write the failing test**

```tsx
import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

it('names every capability Plus adds over Free', () => {
  render(<InboxSimulatorScreen />);
  const free = new Set(TIER_MANIFEST.free.capabilities);
  const added = TIER_MANIFEST.plus.capabilities.filter((c) => !free.has(c));
  const labels = [...new Set(added.map((c) => CAPABILITY_LABELS[c]))];

  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(screen.getByText(new RegExp(label.split('—')[0]!.trim()))).toBeInTheDocument();
  }
});
```

The `split('—')` trims `'Screener — new senders collected for review'` down to `Screener`, because the strip is a compact three-column layout and the full sentence will not fit. Assert on the feature name, not the marketing sentence.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: FAIL — "Screener" and "Quiet hours" are absent from the rendered strip.

- [ ] **Step 3: Derive the strip**

Replace the three hardcoded `<span>` blocks with a derivation. Add above the component:

Import what it needs — `pricing-model.ts` imports only from
`@declutrmail/shared/entitlements`, so this adds no auth edge and the test file's
`mailbox-action-context` throwing-guard stays green:

```tsx
import { TIER_MANIFEST, type TierId } from '@declutrmail/shared/entitlements';
import { CAPABILITY_LABELS } from '@/features/marketing/pricing/pricing-model';

/**
 * What each paid tier ADDS over the one below it, in the manifest's own
 * words. Hand-written before (2026-08-26): the Plus line said "Rules keep
 * it clean for you", which named Autopilot and silently omitted Screener
 * and Quiet hours — both Plus since the 2026-08-23 packaging patch. A
 * plan-comparison strip that a packaging change does not reach is a strip
 * that goes quietly wrong.
 *
 * `CAPABILITY_LABELS` is a total `Record<Capability, string>`, so a new
 * capability without a label is a compile error, and it is deduplicated
 * because `autopilot` and `autopilot-active` deliberately share one label.
 */
function capabilitiesAddedBy(tier: TierId, previous: TierId): readonly string[] {
  const had = new Set(TIER_MANIFEST[previous].capabilities);
  return [
    ...new Set(
      TIER_MANIFEST[tier].capabilities
        .filter((c) => !had.has(c))
        .map((c) => CAPABILITY_LABELS[c].split('—')[0]!.trim()),
    ),
  ];
}
```

Then render `Every plan` with its existing hand-written line (Free's value is the ritual itself, not a capability list), and `Plus` / `Pro` from `capabilitiesAddedBy('plus', 'free')` and `capabilitiesAddedBy('pro', 'plus')`, joined with `·`.

Keep the existing `dm-simulator-plan-path` class and the `<strong>` tier names — the layout and its CSS do not change, only the text inside.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: PASS. The Plus column should now read `Screener · Autopilot · Quiet hours` and Pro `Daily Brief · Follow-ups`.

- [ ] **Step 5: Verify it renders, not just that it passes**

Start the dev server and look at the page — a three-column strip with more text in it can wrap badly, and a test asserting presence will not catch that.

```bash
pnpm --filter @declutrmail/web dev
```

Open `/inbox-simulator`, complete the three guided decisions to reach the completion block, and confirm the strip reads correctly at desktop width and at 375px. If it overflows, shorten via the labels' own leading segment — do not re-hardcode the copy to make it fit.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/marketing/inbox-simulator
git commit -m "fix(marketing): derive the simulator plan strip from the manifest (D245)"
```

---

## Done when

- [ ] `UNIFORM_UNDO_WINDOW_DAYS` derives from the manifest and was watched going `null` under a deliberately divergent ladder, then restored.
- [ ] All nine sites state the window; the sweep in Task 3 Step 5 returns only justified divergent-ladder fallbacks.
- [ ] No literal `30` was introduced for the Activity Undo window anywhere. Gmail Trash's separate 30 stays literal and is commented as Google's, not ours.
- [ ] The simulator uses one connect label.
- [ ] The plan strip names Screener and Quiet hours, and was looked at in a browser at desktop and 375px.
- [ ] Full suites green: `shared`, `web`.
