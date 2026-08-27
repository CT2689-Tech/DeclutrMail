# Inbox Simulator — Plan 4: The four-step arc

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo's three one-sender safety lessons with four steps that prove the hero's actual promises: clear thousands by sender, see the one thing you can't undo, make it stick, and free the space.

**Architecture:** The guided scenario becomes a discriminated union (`row | batch | rule`). Each step renders the product's own components — `DomainBatchCard`, `BatchActionSheet`, the real `ActionSheet`, `ActivateRuleModal` — against locally-built synthetic previews. The demo's hand-rolled `DemoPreviewDialog` is deleted; imitating a product component is what hid the archive-historic toggle for a year.

**Tech Stack:** pnpm workspace, TypeScript 5.9, Vitest, Next.js 15, React 19.

## Global Constraints

- **Blocked until [PR #646](https://github.com/CT2689-Tech/DeclutrMail/pull/646) merges.** Every task edits `inbox-simulator-screen.tsx`, which that PR also edits. Rebase onto `origin/main` after it lands, then start.
- Prerequisites, both already on `feat/d133-engine-fixtures`: Plan 3's engine-derived fixtures (the six adjacent `amazon.com` senders this plan's step 1 needs), and the auth-edge cut that took the route from 15 chunks to 11 with zero authenticated markers.
- **Re-run the chunk measurement after every task.** The route must stay clean. Verify by `app-build-manifest.json` route membership, never by chunk names. The reproduction commands are in `docs/execution/inbox-simulator-chunk-baseline-2026-08-26.md`.
- Never run root `pnpm test` — it livelocks. Use `pnpm --filter @declutrmail/web exec vitest run <path> --no-file-parallelism`.
- Never use `git commit --no-verify`.
- Canonical verbs: Keep · Archive · Unsubscribe · Later · Delete (D227). "Screen" is internal-only.
- D226: the preview is mandatory before every mail-moving action. The demo must not skip it — it is the thing being demonstrated.
- **Autopilot is Plus**, not Pro (moved 2026-08-23). Step 3 must label it correctly.
- Nothing may claim manual actions affect future mail. The public FAQ says they don't.
- No byte/megabyte figures on a Triage row — `TriageDecisionRow` carries no size field and there is no per-sender aggregate anywhere in the product. Step 4 makes its point in messages.
- Commit subjects end `(D133)`.

---

### Task 1: The scenario union

**Files:**

- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.tsx`
- Modify: `apps/web/src/features/marketing/inbox-simulator/inbox-simulator-screen.test.tsx`

**Interfaces:**

- Produces: `type GuidedScenario = RowScenario | BatchScenario | RuleScenario`, each with `kind`, `shortLabel`, `title`, `body`, `prompt`.

Guided mode currently renders exactly one row (`rows = currentScenario ? [currentScenario.row] : []`). Steps 1 and 3 do not render a single row at all, so the union has to land before any step can.

- [ ] **Step 1: Write the failing test**

```tsx
import { GUIDED_SCENARIOS } from './inbox-simulator-screen';

it('has four guided steps in the documented order', () => {
  expect(GUIDED_SCENARIOS.map((s) => s.kind)).toEqual(['batch', 'row', 'rule', 'row']);
  expect(GUIDED_SCENARIOS.map((s) => s.shortLabel)).toEqual([
    'Scale',
    'One-way',
    'Make it stick',
    'Free the space',
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/marketing/inbox-simulator --no-file-parallelism`
Expected: FAIL — `GUIDED_SCENARIOS` is not exported and has three entries.

- [ ] **Step 3: Introduce the union**

```tsx
interface ScenarioBase {
  shortLabel: string;
  title: string;
  body: string;
  prompt: string;
}
/** One sender, one decision — the original demo shape. */
interface RowScenario extends ScenarioBase {
  kind: 'row';
  row: TriageDecisionRow;
}
/** A whole domain decided at once — proves the scale claim. */
interface BatchScenario extends ScenarioBase {
  kind: 'batch';
  domain: string;
}
/** No row at all: an Autopilot rule preview. */
interface RuleScenario extends ScenarioBase {
  kind: 'rule';
}
export type GuidedScenario = RowScenario | BatchScenario | RuleScenario;
```

Rework `firstUndecidedRow`, `hasCompletedGuide` and the `rows` computation to switch on `kind`. A batch step is complete when its domain has a recorded decision; a rule step when the rule decision is recorded.

- [ ] **Step 4: Run test to verify it passes**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/inbox-simulator
git commit -m "refactor(marketing): make the guided demo a scenario union (D133)"
```

---

### Task 2: Step 1 — scale, via the real batch components

**Files:**

- Modify: the screen + its test
- Create: `apps/web/src/features/marketing/inbox-simulator/synthetic-preview.ts`

**Interfaces:**

- Consumes: `findDomainBatches`, `DomainBatchCard`, `BatchActionSheet`, `type BulkActionPreviewResult`.
- Produces: `buildSyntheticBulkPreview(batch: DomainBatch): BulkActionPreviewResult`.

`BatchActionSheet` takes `preview: BulkActionPreviewResult | 'loading' | 'unavailable'` and `mailboxEmail?: string | undefined`. The demo passes a locally-built preview and omits `mailboxEmail` — no network, no auth.

`BulkActionPreviewResult` is `{ senders: Array<{senderId, name, counts, protected}>, totals, protectedCount }`. Build it from the batch's own rows using `syntheticInboxCount`, marking protected rows `protected: true` and excluding them from `totals`.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers the amazon.com batch, excluding the protected sender from the count', () => {
  render(<InboxSimulatorScreen />);
  expect(screen.getByText(/6 senders from amazon\.com/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Archive all 5/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails.** Run the suite; expected FAIL — no batch card renders.

- [ ] **Step 3: Build the synthetic preview and render the card.** `BatchVerb` is `'Archive' | 'Later'` only — Keep is per-sender policy and Unsubscribe depends on each sender's channel. So the Unsubscribe-recommended Amazon row is archived with the rest, or the visitor drops to one-by-one. That is the product's real constraint and it sets up step 2; do not paper over it.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Re-measure the chunk.** Expected: still CLEAN. `BatchActionSheet` reaches `MailboxActionContextView`, not the auth wrapper — confirm that held.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(marketing): open the demo on a mixed-domain batch (D133)"
```

---

### Task 3: Step 2 — the real ActionSheet, and delete the imitation

**Files:**

- Modify: the screen + its test

`DemoPreviewDialog` is a hand-rolled copy of `ActionSheet`. It is why the archive-historic toggle never appeared in the demo: the product grew a control and the imitation did not. **Delete it** and render the product's `ActionSheet`.

`ActionSheet` takes `open`, `verb`, `row`, `inboxCount`, `mailboxEmail?`, `onCancel`, `onConfirm(details: ConfirmDetails)`. `ConfirmDetails` carries `archiveHistoric`, `wakeAt`, `rememberPreference`. The demo reads `archiveHistoric` to decide whether its recorded outcome includes the backlog.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers the historic-archive option on Unsubscribe, off by default', async () => {
  // reach step 2, choose Unsubscribe, then:
  const toggle = screen.getByRole('checkbox', {
    name: /Also archive the .* already in the inbox/i,
  });
  expect(toggle).toHaveAttribute('aria-checked', 'false');
});
```

- [ ] **Step 2: Run to verify it fails** — the demo's own dialog has no such control.

- [ ] **Step 3: Swap in `ActionSheet`, delete `DemoPreviewDialog`.** The label's number is the **live inbox count** (`syntheticInboxCount`), never the all-time total — D226 is explicit that the toggle carries the live count and never a lifetime estimate.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Re-measure the chunk.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(marketing): use the product's own action sheet in the demo (D133)"
```

---

### Task 4: Step 3 — the Autopilot rule

**Files:**

- Modify: the screen + its test
- Modify: `synthetic-preview.ts`

**Interfaces:**

- Consumes: `ActivateRuleModal`, `type AutopilotRuleDto`, `type RulePreviewState`, `MIN_UNDO_WINDOW_DAYS`.
- Produces: `SYNTHETIC_RULE: AutopilotRuleDto` and `buildSyntheticRulePreview(): RulePreviewState`.

`ActivateRuleModal` is fully props-driven — `rule`, `preview`, `undoWindowDays`, `mailboxEmail`, `onWatchFirst`, `onConfirm`, `onCancel`. `onWatchFirst` is Observe mode: the rule collects matches instead of acting. That is a real product mode and it is what lets this step end on an offer rather than a limitation.

Pass `undoWindowDays={MIN_UNDO_WINDOW_DAYS}` — do not hardcode 30.

- [ ] **Step 1: Write the failing test**

```tsx
it('offers both turning the rule on and watching first, and names Plus', () => {
  // reach step 3, then:
  expect(screen.getByRole('button', { name: /Turn it on/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Watch first/i })).toBeInTheDocument();
  expect(screen.getByText(/\bPlus\b/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Build the synthetic rule and render the modal.** The preview lists senders the rule would match — draw them from the fixtures the visitor just archived, so the step reads as the consequence of step 1 rather than a new topic. State that Protected senders are never matched.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Re-measure the chunk.** `ActivateRuleModal` reaches `ConfirmModalFrame`, which Plan 1 cut from the auth wrapper. Confirm that held.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(marketing): show an Autopilot rule preview in the demo (D133)"
```

---

### Task 5: Step 4, the completion screen, and storage v4

**Files:**

- Modify: the screen + its test

**Step 4 — free the space.** After three steps of Archive, state plainly that archiving freed no storage and offer Delete. Copy comes from `DELETE_RECOVERY_CLAIM` and `MANUAL_ACTION_SCOPE_CLAIM`, both of which already separate Activity Undo from Gmail Trash recovery — two mechanisms that happen to share the number 30. Import them; do not retype them.

**Completion.** Project **backlog cleared**, never future mail. Show a **measured** elapsed time — stamp the start in an effect on the first decision, never during render, and never write a number in. Put `CASA_VERIFICATION_APPROVED_ON` next to the connect CTA.

**Storage v4.** Decisions now include a batch decision and a rule decision, so the stored shape genuinely changes. Bump `STORAGE_KEY` to `…state.v4`, add the new decision kinds to the parser, and keep the existing strictness — one malformed entry rejects the whole snapshot, because a partial restore silently changes which decisions the visitor appears to have made.

- [ ] **Step 1: Write the failing tests**

```tsx
it('projects backlog cleared, never future mail', () => {
  // complete the guide, then:
  expect(screen.queryByText(/future emails? will skip/i)).not.toBeInTheDocument();
  expect(screen.getByText(/cleared/i)).toBeInTheDocument();
});

it('rejects a v3 snapshot rather than half-restoring it', () => {
  localStorage.setItem(
    'dm.inbox-simulator.state.v4',
    JSON.stringify({ version: 3, mode: 'guided', decisions: [] }),
  );
  render(<InboxSimulatorScreen />);
  expect(screen.getByText(/Guided decision 1 of 4/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement step 4, the completion screen, and the v4 parser.**

- [ ] **Step 4: Run to verify they pass.**

- [ ] **Step 5: Negative control on the timer.** Freeze the clock, complete the guide, confirm the elapsed figure reflects the frozen delta rather than a constant. A hardcoded number passes every other assertion in this plan.

- [ ] **Step 6: Re-measure the chunk. Final measurement — record it in the baseline doc.**

- [ ] **Step 7: Smoke the whole thing.**

```bash
pnpm --filter @declutrmail/web dev
```

Walk all four steps at desktop **and** 375px. Steps 1–4 mount app-surface modals that have never rendered on a public route. Check: mid-step reload, backing out of a sheet, dismissing the batch, reset, completion, replay. Read the generated reasoning on several rows — a template artefact passes every test and looks broken to a visitor. No console errors.

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(marketing): close the demo on storage and a measured outcome (D133)"
```

---

## Done when

- [ ] Four guided steps in order: batch · unsubscribe · rule · delete.
- [ ] `DemoPreviewDialog` is deleted and the product's `ActionSheet` renders in its place, historic toggle included.
- [ ] The route's chunk set is still CLEAN of authenticated markers, measured after the final task.
- [ ] Elapsed time is measured and was watched changing under a frozen clock.
- [ ] Nothing claims manual actions touch future mail; no byte figures on a row; Autopilot labelled Plus.
- [ ] Smoked at desktop and 375px across every state, including reload mid-step.
- [ ] `pnpm --filter @declutrmail/web exec vitest run --no-file-parallelism` green; `pnpm typecheck` clean.
