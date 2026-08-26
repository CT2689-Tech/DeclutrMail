# Inbox Simulator — Plan 1: Foundations

> **Status: executed.** Plan 1 ran on `feat/d133-inbox-simulator-scale`,
> commit range `101bc6dd..HEAD`. All five tasks landed; checkboxes below
> are ticked to match. Plans 2–4 of `inbox-simulator-scale-spec-2026-08-26.md`
> remain unplanned.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the triage cascade callable from the browser and stop app-surface modals dragging the auth/query layer into the public marketing chunk — the two prerequisites for everything else in `inbox-simulator-scale-spec-2026-08-26.md`.

**Architecture:** `runCascade` and its template renderer move from `packages/workers` to `packages/shared`, which is zero-server-dep, so the two DB enum types they use get mirrored into `shared/contracts` behind the same fail-compile drift guard `GmailCategory` already carries. Separately, `MailboxActionContext` splits into a presentational core and a thin auth-reading wrapper, cutting a module boundary the component's own docblock already anticipated.

**Tech Stack:** pnpm workspace, TypeScript 5.9, Vitest, Next.js 15, React 19.

## Global Constraints

- **`@declutrmail/shared` is zero-server-dep.** It must never import `@declutrmail/db`, `drizzle-orm`, `postgres`, or anything from `apps/api`. Mirror types instead, guarded by compile-time assertions.
- **Never run root `pnpm test`.** It livelocks. Use per-package: `pnpm --filter <pkg> exec vitest run <path> --no-file-parallelism`.
- **No `--no-verify`.** Husky runs prettier on staged files; if a commit is rejected for formatting, run `pnpm exec prettier --write <file>` and re-commit.
- **Prelaunch means no back-compat shims.** There are no production users. Update call sites directly; do not leave re-export aliases behind.
- **Branch:** `feat/d133-inbox-simulator-scale` (already exists, spec committed).
- **Commit trailer:** every commit subject ends `(D133)`.

---

### Task 1: Mirror the two DB enums into shared

`score-cascade.ts` imports `TriageVerdict` and `ProtectionReason` from `@declutrmail/db`. Shared cannot depend on db, so both get mirrored first — with the drift guard in place **before** the mirror exists, so you watch it fail.

**Files:**

- Create: `packages/shared/src/contracts/triage-enums.ts`
- Modify: `packages/shared/src/contracts/index.ts`
- Modify: `apps/api/src/senders/senders.types.ts` (append near the existing `_GMAIL_CATEGORY_*` assertions at the end of the file)

**Interfaces:**

- Consumes: nothing.
- Produces: `TriageVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later'` and `ProtectionReason = 'user_defined' | 'replied' | 'starred' | 'gmail_important'`, both exported from `@declutrmail/shared/contracts`. Task 2 imports both.

- [x] **Step 1: Write the failing guard**

Append to `apps/api/src/senders/senders.types.ts`, directly below the existing `_GMAIL_CATEGORY_SHARED_EXTENDS_API` constant:

```ts
/**
 * Cross-package contract — the DB-derived triage enums must stay equal
 * to the shared zero-server-dep mirrors the browser-side cascade reads
 * (`@declutrmail/shared/triage-engine`). Failing-compile is preferable
 * to a demo that renders a verdict the engine cannot produce.
 */
import type { triageVerdict, protectionReason } from '@declutrmail/db';
import type {
  TriageVerdict as SharedTriageVerdict,
  ProtectionReason as SharedProtectionReason,
} from '@declutrmail/shared/contracts';

type DbTriageVerdict = (typeof triageVerdict)['enumValues'][number];
type DbProtectionReason = (typeof protectionReason)['enumValues'][number];

const _TRIAGE_VERDICT_DB_EXTENDS_SHARED: DbTriageVerdict extends SharedTriageVerdict
  ? true
  : false = true;

const _TRIAGE_VERDICT_SHARED_EXTENDS_DB: SharedTriageVerdict extends DbTriageVerdict
  ? true
  : false = true;

const _PROTECTION_REASON_DB_EXTENDS_SHARED: DbProtectionReason extends SharedProtectionReason
  ? true
  : false = true;

const _PROTECTION_REASON_SHARED_EXTENDS_DB: SharedProtectionReason extends DbProtectionReason
  ? true
  : false = true;
```

- [x] **Step 2: Run typecheck to verify it fails**

Run: `pnpm --filter @declutrmail/api exec tsc --noEmit`
Expected: FAIL — `Module '"@declutrmail/shared/contracts"' has no exported member 'TriageVerdict'`.

- [x] **Step 3: Write the mirror**

Create `packages/shared/src/contracts/triage-enums.ts`:

```ts
/**
 * TriageVerdict / ProtectionReason — cross-package mirrors of the
 * `triage_verdict` and `protection_reason` Postgres enums.
 *
 * The DB schema is canonical: `packages/db/src/schema/triage-decisions.ts`
 * and `packages/db/src/schema/sender-policies.ts`. These mirrors exist
 * because `@declutrmail/shared` is zero-server-dep and the triage cascade
 * now runs here (see `../triage-engine`), including in the browser for
 * the public inbox simulator.
 *
 * Contract assertions at the end of `apps/api/src/senders/senders.types.ts`
 * fail-compile if either mirror drifts from its enum — the same guard
 * `GmailCategory` already carries.
 *
 * NOTE: these are the DATABASE spellings. The triage wire type in
 * `apps/web/src/features/triage/data.ts` uses a different dialect
 * (`manual` / `gmail-important`); `normalizeProtectionReason` in
 * `@declutrmail/shared/copy` resolves between them. Do not "fix" one to
 * match the other here.
 */
export type TriageVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later';

export type ProtectionReason = 'user_defined' | 'replied' | 'starred' | 'gmail_important';
```

Add to `packages/shared/src/contracts/index.ts`, beside the existing `GmailCategory` line:

```ts
export type { TriageVerdict, ProtectionReason } from './triage-enums';
```

- [x] **Step 4: Run typecheck to verify it passes**

Run: `pnpm --filter @declutrmail/api exec tsc --noEmit && pnpm --filter @declutrmail/shared exec tsc --noEmit`
Expected: PASS, both.

- [x] **Step 5: Negative control — prove the guard bites**

Temporarily add a bogus member to the mirror:

```ts
export type TriageVerdict = 'keep' | 'archive' | 'unsubscribe' | 'later' | 'screen';
```

Run: `pnpm --filter @declutrmail/api exec tsc --noEmit`
Expected: FAIL on `_TRIAGE_VERDICT_SHARED_EXTENDS_DB` — `Type 'false' is not assignable to type 'true'`.

**Then remove `| 'screen'` and re-run to confirm PASS.** A guard you never watched fail has verified nothing.

- [x] **Step 6: Commit**

```bash
git add packages/shared/src/contracts/triage-enums.ts packages/shared/src/contracts/index.ts apps/api/src/senders/senders.types.ts
git commit -m "refactor(shared): mirror triage enums for the browser cascade (D133)"
```

---

### Task 2: Move the cascade into shared

**Files:**

- Move: `packages/workers/src/score-cascade.ts` → `packages/shared/src/triage-engine/cascade.ts`
- Move: `packages/workers/src/score-cascade.test.ts` → `packages/shared/src/triage-engine/cascade.test.ts`
- Create: `packages/shared/src/triage-engine/index.ts`
- Modify: `packages/shared/package.json` (exports map)
- Modify: `packages/workers/src/reasoning.ts:3`, `packages/workers/src/score.worker.ts:35`, `packages/workers/src/index.ts:173,180`

**Interfaces:**

- Consumes: `TriageVerdict`, `ProtectionReason` from Task 1.
- Produces: `runCascade(signals: SenderSignals): CascadeResult`, plus the types `SenderSignals`, `CascadeResult`, `CascadePhase`, `CascadeRuleId`, `UnsubscribeChannel`, and `MIN_BATCH_RUN`-unrelated helpers already exported by the file — all from `@declutrmail/shared/triage-engine`. Plan 3 builds fixtures against `SenderSignals` and asserts against `CascadeResult.verdict`.

- [x] **Step 1: Move both files with history preserved**

```bash
mkdir -p packages/shared/src/triage-engine
git mv packages/workers/src/score-cascade.ts packages/shared/src/triage-engine/cascade.ts
git mv packages/workers/src/score-cascade.test.ts packages/shared/src/triage-engine/cascade.test.ts
```

- [x] **Step 2: Retarget the type import**

In `packages/shared/src/triage-engine/cascade.ts`, replace line 1:

```ts
import type { ProtectionReason, TriageVerdict } from '@declutrmail/db';
```

with:

```ts
import type { ProtectionReason, TriageVerdict } from '../contracts';
```

`UnsubscribeChannel` is declared locally in this file (line ~127) and moves with it — it needs no mirror.

In `packages/shared/src/triage-engine/cascade.test.ts`, change the import from `'./score-cascade.js'` to `'./cascade.js'`.

- [x] **Step 3: Create the module entry point**

Create `packages/shared/src/triage-engine/index.ts`:

```ts
/**
 * The deterministic triage cascade (D20, D21, D22).
 *
 * Lives in shared rather than workers because it runs in two places: the
 * score worker, and the browser, where the public inbox simulator derives
 * its fixture verdicts from it (D133). A fixture that hardcoded a verdict
 * could show a recommendation the engine would never make; deriving it
 * means the demo cannot drift from the engine.
 */
export { runCascade, isGovernmentDomain } from './cascade';
export type {
  SenderSignals,
  CascadeResult,
  CascadePhase,
  CascadeRuleId,
  UnsubscribeChannel,
} from './cascade';
```

Re-export the file's **complete** surface as it stands today: `runCascade`,
`isGovernmentDomain`, `CASCADE_RULE_PHRASE`, `CASCADE_RULE_IDS`,
`MIN_UNSUB_STREAM_VOLUME`, `GOV_UNSUB_CONFIDENCE_CAP`, and the types
`SenderSignals`, `CascadeResult`, `CascadePhase`, `CascadeRuleId`,
`UnsubscribeChannel`. `packages/workers/src/index.ts` already re-exports several
of these onward to `apps/api`, so dropping one silently breaks a consumer this
plan never looks at.

- [x] **Step 4: Add the subpath export**

In `packages/shared/package.json`, add to `exports`, keeping the keys alphabetical:

```json
"./triage-engine": "./src/triage-engine/index.ts",
```

- [x] **Step 5: Update the workers call sites**

`packages/workers/src/reasoning.ts` line 3:

```ts
import type { CascadeResult, CascadeRuleId } from '@declutrmail/shared/triage-engine';
```

`packages/workers/src/score.worker.ts` — the import block ending line 35 changes its specifier from `'./score-cascade.js'` to `'@declutrmail/shared/triage-engine'`.

`packages/workers/src/index.ts` lines 173 and 180 — same specifier change. These are re-exports; keep them, because `apps/api` consumes the cascade through the workers barrel and this plan does not change that surface.

- [x] **Step 6: Run the moved suite — this is the negative control**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/triage-engine/cascade.test.ts --no-file-parallelism`
Expected: PASS, every case, unchanged.

This suite covered every D21 branch before the move. It is the whole safety net for this task: a move that changed behavior breaks it. If any case fails, the move is wrong — do not edit the test to match.

- [x] **Step 7: Typecheck every affected package**

Run: `pnpm --filter @declutrmail/shared exec tsc --noEmit && pnpm --filter @declutrmail/workers exec tsc --noEmit && pnpm --filter @declutrmail/api exec tsc --noEmit`
Expected: PASS, all three.

- [x] **Step 8: Confirm shared stayed zero-server-dep**

Run: `grep -rn "@declutrmail/db\|drizzle-orm\|from 'postgres'" packages/shared/src/`
Expected: no output. Any hit means a server dependency leaked into shared and the move must be corrected, not the grep.

- [x] **Step 9: Run the workers suite for regressions**

Run: `pnpm --filter @declutrmail/workers exec vitest run --no-file-parallelism`
Expected: PASS. Note this suite is large; allow several minutes.

- [x] **Step 10: Commit**

```bash
git add packages/shared packages/workers
git commit -m "refactor(shared): move the triage cascade out of workers (D133)"
```

---

### Task 3: Move the reasoning template into the same module

The fixtures currently hardcode reasoning copy that is itself template output. Deriving it removes another retyped thing. Only the pure renderer moves — the LLM adapter, limiter and env resolvers stay in workers.

**Files:**

- Create: `packages/shared/src/triage-engine/template.ts`
- Modify: `packages/workers/src/reasoning.ts` (remove `VERDICT_LABEL` and `renderTemplate`, re-import them)
- Modify: `packages/shared/src/triage-engine/index.ts`
- Create: `packages/shared/src/triage-engine/template.test.ts`

**Interfaces:**

- Consumes: `CascadeResult` from Task 2.
- Produces: `renderTemplate(displayName: string, result: CascadeResult): string` and `VERDICT_LABEL`, exported from `@declutrmail/shared/triage-engine`. Plan 3 uses `renderTemplate` to derive each fixture's `reasoning` field.

- [x] **Step 1: Write the failing test**

Create `packages/shared/src/triage-engine/template.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { runCascade, renderTemplate } from './index';

describe('renderTemplate', () => {
  it('names the sender and its measured read rate', () => {
    const result = runCascade({
      isProtected: false,
      hasWrittenTo: false,
      gmailCategory: 'promotions',
      starredInLastYear: false,
      readRate90d: 0,
      firstSeenMonthsAgo: 24,
      firstSeenDaysAgo: 730,
      lastSeenDaysAgo: 0,
      totalMessages: 1745,
      monthlyVolume: 52,
      spikeRatio: 3,
      unsubscribeChannel: 'one_click',
      isGovDomain: false,
      userManuallyArchivedCount: 0,
    });

    expect(renderTemplate('Groupon', result)).toContain('Groupon');
    // Interpolated, not coincidental: the same result under a different
    // display name must produce that name and not the first one.
    const other = renderTemplate('Old Navy', result);
    expect(other).toContain('Old Navy');
    expect(other).not.toContain('Groupon');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/triage-engine/template.test.ts --no-file-parallelism`
Expected: FAIL — `renderTemplate` is not exported from `./index`.

- [x] **Step 3: Move the renderer**

Cut `VERDICT_LABEL` (line ~67) and `renderTemplate` (line ~83) out of `packages/workers/src/reasoning.ts` verbatim into a new `packages/shared/src/triage-engine/template.ts`, with this header:

```ts
/**
 * Deterministic reasoning copy (D24 template fallback).
 *
 * Pure string building over a `CascadeResult` — no LLM, no clock, no IO.
 * Lives beside the cascade because both the score worker and the public
 * inbox simulator render it; the LLM path (`ReasoningLlmPort`, the
 * limiter and the env resolvers) stays in `packages/workers/src/reasoning.ts`,
 * which is server-only.
 */
import type { CascadeResult } from './cascade';
```

Keep the bodies byte-identical. If `renderTemplate` references `triageVerdict.enumValues`, replace that reference with the shared `TriageVerdict` mirror — shared must not import `@declutrmail/db`.

Re-export from `packages/shared/src/triage-engine/index.ts`:

```ts
export { renderTemplate, VERDICT_LABEL } from './template';
```

In `packages/workers/src/reasoning.ts`, replace the deleted declarations with a re-export so the workers barrel surface is unchanged:

```ts
export { renderTemplate, VERDICT_LABEL } from '@declutrmail/shared/triage-engine';
```

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @declutrmail/shared exec vitest run src/triage-engine --no-file-parallelism`
Expected: PASS, both files.

- [x] **Step 5: Confirm no workers regression**

Run: `pnpm --filter @declutrmail/workers exec vitest run --no-file-parallelism && pnpm --filter @declutrmail/workers exec tsc --noEmit`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/shared packages/workers
git commit -m "refactor(shared): move the reasoning template beside the cascade (D133)"
```

---

### Task 4: Split MailboxActionContext

`BatchActionSheet` and `ConfirmModalFrame` both import `MailboxActionContext`, which imports `auth-provider`, which imports `useMe` (TanStack Query) and the API client. The public simulator needs those two components in Plan 4; importing them as-is drags the query layer into the public marketing chunk. Tree-shaking does not help — it is per-module.

The component already accepts a `mailboxEmail` override documented "for isolated previews". The design intent exists; the module boundary was never cut.

**Files:**

- Create: `apps/web/src/features/auth/mailbox-action-context-view.tsx`
- Modify: `apps/web/src/features/auth/mailbox-action-context.tsx`
- Modify: `apps/web/src/features/triage/batch-action-sheet.tsx:6,136` (import swap only)
- Modify: `apps/web/src/features/autopilot/confirm-modal-frame.tsx:5,152` + props signature
- Modify: `apps/web/src/features/autopilot/activate-rule-modal.tsx` (forward the prop)
- Modify: `apps/web/src/features/autopilot/approve-confirm-modal.tsx` (forward the prop)
- Modify: `apps/web/src/features/autopilot/autopilot-screen.tsx:920,935` (pass `activeEmail`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `MailboxActionContextView({ mailboxEmail }: { mailboxEmail?: string | undefined })` — presentational, zero auth imports — from `@/features/auth/mailbox-action-context-view`. `MailboxActionContext` keeps its current name, props and behaviour for app surfaces. Plan 4 renders `BatchActionSheet` and `ActivateRuleModal` on the public route relying on this split.

- [x] **Step 1: Write the failing test**

Create `apps/web/src/features/auth/mailbox-action-context-view.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MailboxActionContextView } from './mailbox-action-context-view';

describe('MailboxActionContextView', () => {
  it('renders the supplied mailbox without any auth provider mounted', () => {
    render(<MailboxActionContextView mailboxEmail="demo@example.com" />);
    expect(screen.getByText(/demo@example\.com/)).toBeInTheDocument();
  });

  it('renders nothing when no mailbox is supplied', () => {
    const { container } = render(<MailboxActionContextView mailboxEmail={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

The first case is the point: it mounts with **no** `AuthProvider` in the tree. Today's component would throw or return null via `useOptionalAuth`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/auth/mailbox-action-context-view.test.tsx --no-file-parallelism`
Expected: FAIL — cannot resolve `./mailbox-action-context-view`.

- [x] **Step 3: Extract the presentational core**

Open `apps/web/src/features/auth/mailbox-action-context.tsx` and read its current render body. Move that body verbatim into a new `apps/web/src/features/auth/mailbox-action-context-view.tsx`:

```tsx
'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * The mailbox note shown above an action preview — presentational only.
 *
 * Split from `MailboxActionContext` (2026-08-26, D133) so surfaces that
 * already know their mailbox can render it WITHOUT importing
 * `auth-provider`. That import pulls `useMe` and the API client, and the
 * public inbox simulator renders `BatchActionSheet` and `ActivateRuleModal`
 * on a marketing route where the query layer must not land in the chunk.
 * Tree-shaking cannot remove it, because it is per-module.
 */
export function MailboxActionContextView({ mailboxEmail }: { mailboxEmail?: string | undefined }) {
  if (!mailboxEmail) return null;

  return (
    <div
      role="note"
      aria-label={`Gmail account: ${mailboxEmail}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '7px 10px',
        borderRadius: 7,
        border: `1px solid ${color.line}`,
        background: color.paper,
        color: color.fgSoft,
        fontFamily: font.sans,
        fontSize: 11.5,
        lineHeight: 1.4,
      }}
    >
      <span>Gmail account</span>
      <strong
        style={{
          color: color.fg,
          fontFamily: font.mono,
          fontSize: 11,
          overflowWrap: 'anywhere',
        }}
      >
        {mailboxEmail}
      </strong>
    </div>
  );
}
```

Replace the body of `mailbox-action-context.tsx` with the auth-reading wrapper:

```tsx
'use client';

import { getActiveMailboxEmail, useOptionalAuth } from './auth-provider';
import { MailboxActionContextView } from './mailbox-action-context-view';

/**
 * Auth-reading wrapper — resolves the active mailbox, then delegates to
 * the presentational view. App surfaces use this; public surfaces import
 * the view directly and pass the mailbox (or nothing) themselves.
 */
export function MailboxActionContext({ mailboxEmail }: { mailboxEmail?: string | undefined }) {
  const auth = useOptionalAuth();
  const email = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

  return <MailboxActionContextView mailboxEmail={email ?? undefined} />;
}
```

That precedence is today's, unchanged: an explicit prop wins, otherwise the active
mailbox from `AuthProvider`, otherwise nothing renders. Two details worth copying
exactly — `getActiveMailboxEmail` takes `auth.me`, not `auth`, and it can return
`null`, which the view treats the same as `undefined`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/auth/mailbox-action-context-view.test.tsx --no-file-parallelism`
Expected: PASS, both cases.

- [x] **Step 5: Point the two modal components at the view**

The two components are **not** symmetric here, and the difference is the whole
task. Verified 2026-08-26:

- `batch-action-sheet.tsx:136` already renders `<MailboxActionContext mailboxEmail={mailboxEmail} />`,
  and `triage-screen.tsx:1349` already passes `mailboxEmail={activeEmail}`. This one is
  an import swap and nothing else.
- `confirm-modal-frame.tsx:152` renders `<MailboxActionContext />` with **no prop**, and
  `mailboxEmail` is **not** in its props signature. It needs the prop added and threaded
  from every consumer.

The full chain to thread, in this order:

1. `confirm-modal-frame.tsx` — add `mailboxEmail?: string | undefined` to the props
   signature (beside `pendingAction`), and render
   `<MailboxActionContextView mailboxEmail={mailboxEmail} />` at line 152.
2. `activate-rule-modal.tsx` and `approve-confirm-modal.tsx` — these are the only two
   consumers of `ConfirmModalFrame` (`pause-confirm-modal.tsx` does not use it, so it
   needs no change). Add the same optional prop to each and forward it to
   `ConfirmModalFrame`.
3. `autopilot-screen.tsx` — the call sites at lines 920 (`<ApproveConfirmModal`) and
   935 (`<ActivateRuleModal`). This screen already resolves the mailbox at line 168
   (`const activeEmail = auth ? getActiveMailboxEmail(auth.me) : null`), so pass
   `mailboxEmail={activeEmail ?? undefined}` to both. `activeEmail` is `string | null`
   and the view takes `string | undefined` — the `?? undefined` is required, not
   cosmetic.

In `apps/web/src/features/triage/batch-action-sheet.tsx` and `apps/web/src/features/autopilot/confirm-modal-frame.tsx`, change:

```tsx
import { MailboxActionContext } from '@/features/auth/mailbox-action-context';
```

to:

```tsx
import { MailboxActionContextView } from '@/features/auth/mailbox-action-context-view';
```

and rename the JSX usage to `<MailboxActionContextView mailboxEmail={mailboxEmail} />`.

App behaviour must be identical: every dialog that shows the mailbox note today keeps
showing the same address. If a note disappears in the smoke, a link in the chain above
was missed.

Confirm you found every consumer — this exact grep is what produced the list above, and
`--include` is omitted deliberately because this shell (zsh) errors on it when nothing
matches:

```bash
grep -rln "ConfirmModalFrame" apps/web/src | grep -v "test\|stories"
```

- [x] **Step 6: Verify no auth import survives in either modal path**

Run:

```bash
grep -rn "auth-provider\|mailbox-action-context'" apps/web/src/features/triage/batch-action-sheet.tsx apps/web/src/features/autopilot/confirm-modal-frame.tsx
```

Expected: no output.

- [x] **Step 7: Run the affected suites**

Run: `pnpm --filter @declutrmail/web exec vitest run src/features/triage src/features/autopilot src/features/auth --no-file-parallelism`
Expected: PASS. Any test that mounted these modals inside an auth provider should still pass; if one fails because the mailbox note went missing, a call site in Step 5 was missed.

- [x] **Step 8: Typecheck and commit**

```bash
pnpm --filter @declutrmail/web exec tsc --noEmit
git add apps/web/src/features/auth apps/web/src/features/triage apps/web/src/features/autopilot
git commit -m "refactor(web): split the mailbox note from its auth read (D133)"
```

---

### Task 5: Prove the public chunk stayed clean

Chunk names lie. The only evidence is module membership in the build manifest. This task records the baseline that Plan 4 must not regress.

**Files:**

- Create: `docs/execution/inbox-simulator-chunk-baseline-2026-08-26.md`

**Interfaces:**

- Consumes: Task 4's split.
- Produces: a recorded baseline of the modules in the `/inbox-simulator` first-load chunk set. Plan 4's final task re-runs this check and diffs against it.

- [x] **Step 1: Build the web app**

Run: `pnpm --filter @declutrmail/web build`
Expected: build succeeds.

- [x] **Step 2: Extract the route's module list**

**Corrected 2026-08-26** (see `docs/execution/inbox-simulator-chunk-baseline-2026-08-26.md`
§ Step 2): `app-build-manifest.json` has two keys containing the substring
`inbox-simulator` (the page and its OG-image route), and a bare `next(...)` match on the
substring is not guaranteed to pick the page — it picked the OG-image route when this was
first run. Filter on `k.endswith('/page')` as well:

```bash
python3 - <<'PY'
import json, pathlib
m = json.loads(pathlib.Path('apps/web/.next/app-build-manifest.json').read_text())
key = next(k for k in m['pages'] if 'inbox-simulator' in k and k.endswith('/page'))
files = m['pages'][key]
print(key)
for f in sorted(files):
    print(' ', f)
PY
```

- [x] **Step 3: Confirm the query layer is absent**

**Corrected 2026-08-26** (see the same baseline doc, § Step 3): this literal command
produces a false PASS. `react-query` (the npm package name) never appears in compiled
output — it is stripped before this point — and every `useMe` hit is minified React's own
`useMemo`/`useMemoCache`, not the app's `useMe` hook, whose identifier does not survive
minification. Search for `useMe`'s runtime string signature instead, recursively (not just
the top-level glob):

```bash
grep -rl "/api/auth/me" apps/web/.next/static/chunks/
grep -rl "/api/me/timezone" apps/web/.next/static/chunks/
```

Cross-reference any hit against the file list from Step 2. A hit in a chunk that is
**not** in the `/inbox-simulator` list is fine — that is the app shell. A hit in a chunk
that **is** in the list means the split failed and Task 4 must be corrected.

- [x] **Step 4: Record the baseline**

Write the Step 2 output and the Step 3 verdict into `docs/execution/inbox-simulator-chunk-baseline-2026-08-26.md`, with the commit SHA it was measured at (`git rev-parse --short HEAD`).

State the numbers you measured. Do not estimate or round a figure you did not observe.

- [x] **Step 5: Commit**

```bash
git add docs/execution/inbox-simulator-chunk-baseline-2026-08-26.md
git commit -m "docs(web): record the simulator chunk baseline (D133)"
```

---

## Done when

- [x] `runCascade` and `renderTemplate` import cleanly from `@declutrmail/shared/triage-engine` with no server dependency.
- [x] The moved cascade suite passes unchanged — no test was edited to accommodate the move.
- [x] The enum drift guard was watched failing, then passing.
- [x] `BatchActionSheet` and `ConfirmModalFrame` contain no path to `auth-provider`.
- [x] Web, workers, shared and api all typecheck.
- [x] The chunk baseline is recorded with a real measurement.

**No user-visible change ships in this plan.** That is intended: it is the prerequisite for Plans 2–4, and every step is verifiable without a running product.
