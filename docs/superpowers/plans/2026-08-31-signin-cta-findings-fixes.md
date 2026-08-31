# Sign-in CTA QA Findings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7 still-open, in-scope findings from the `/ct-qa sign-in` run
(`docs/qa/qa-worklist.md`, `## sign-in` section, filed 2026-08-29), verified
against `origin/main` at `847de16f` (2026-08-31).

**Architecture:** All changes are copy or a single missing-guard-condition fix
inside existing marketing (Tier 2, `apps/web/src/features/marketing/**`) and
billing (`apps/web/src/features/billing/plan-picker.tsx`) surfaces. No new
components, no schema changes, no API changes. Every exact replacement string
below is either the `usability-editor`'s suggested text from the original QA
run, or derived directly from an existing manifest constant
(`TIER_MANIFEST`, `MIN_UNDO_WINDOW_DAYS`) per CLAUDE.md's source-of-truth
precedence (never hardcode a value the manifest already owns).

**Tech Stack:** Next.js App Router (Server Components for marketing pages),
Vitest + Testing Library.

## Scope decisions (read before starting)

Three of the ten original findings are deliberately **excluded** from this
plan:

- **QA-sign-in-20260829-04** (stale "Connect your Gmail" copy for an
  already-connected visitor, across 10+ marketing surfaces) — the only way to
  fix this is to make marketing pages session-aware, which conflicts with
  D134's documented, deliberate design: the `(marketing)` route group renders
  with **no** `AuthProvider` specifically for prerenderability, and this is
  pinned by `public-shell.test.tsx`. The finding itself confirms the
  destination already redirects a live session straight to `/senders` before
  hitting Google, so the defect is cosmetic-only (wrong button label,
  zero functional cost). Fixing it properly is a bigger, separate
  architectural change (a non-blocking client-side session probe + swap) that
  deserves its own plan, not a bundled copy fix. Left `Open` in the worklist.
- **QA-sign-in-20260829-08** (`/sign-in` step 3 copy allegedly a 52-word
  paraphrase of the bold line above it) — **already resolved on `main`**.
  `git log -p` on `auth-entry.tsx` shows step 3 has directly interpolated
  `{ACTION_PREVIEW_CLAIM}` (the exact fix the finding suggests) since PR #637,
  which predates this finding's 2026-08-29 filing date. No action needed;
  mark `Gone` in the worklist with this commit as the evidence.
- **QA-sign-in-20260829-10** (Founding Pro re-lock UI, reachable but unhit) —
  the finding's own text says it needs "evidence (a real founding member)
  before this is worth prioritizing," and a fresh check
  (`select count(*) from subscriptions where founding_member=true and
  status='active'`) still returns 0. Nothing to fix without a live instance.
  Left `Open`.

The 7 tasks below cover every remaining open, in-scope finding:
QA-01, QA-02, QA-03, QA-05, QA-06, QA-07, QA-09.

## Global Constraints

- Canonical verbs K/A/U/L/D only in product-surface UI — not touched by this
  plan (marketing copy only).
- `ACTION_SAFETY_SUMMARY` and `ACTION_PREVIEW_CLAIM`
  (`packages/shared/src/copy/action-safety.ts`) are both "canonical
  product-truth copy" per that file's own header comment — a change to one
  must not reintroduce disagreement with the other.
- Never hardcode a manifest-owned value (a plan cap, an undo-window day
  count) as a literal in marketing copy — import it from
  `@declutrmail/shared/entitlements` (`TIER_MANIFEST`, `MIN_UNDO_WINDOW_DAYS`).
- The homepage hero (`apps/web/src/features/marketing/landing/hero.tsx`) is a
  PR-3-frozen golden screen. Its H1 is D250-locked and must not be touched.
  Every other line in this plan's hero.tsx edits is copy-only or an
  additive line — no layout restructuring.
- Every task's implementer runs the negative control (CLAUDE.md §8): revert
  the fix, confirm the new assertion goes RED, restore, confirm GREEN.
- Scoped test commands only — never a full-monorepo `pnpm test` run. Use the
  package-scoped command shown in each task.

---

### Task 1: Fix `ACTION_SAFETY_SUMMARY`'s precision-claim contradiction (QA-sign-in-20260829-01)

**Files:**
- Modify: `packages/shared/src/copy/action-safety.ts:7-8`
- Modify: `packages/shared/src/copy/action-safety.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. `ACTION_SAFETY_SUMMARY`'s exported shape (a
  `string`) is unchanged; only its content changes. Every existing consumer
  (`privacy/page.tsx`, `terms/page.tsx`, `help/page.tsx`,
  `pricing-screen.tsx`, `inbox-simulator-screen.tsx`, `landing/faq.tsx`)
  picks up the corrected text automatically — none of them need editing.

**Problem:** `ACTION_SAFETY_SUMMARY`'s first sentence — "you see exactly
which emails are affected" — is rendered on the homepage via the FAQ
("Can it mess up my inbox?", `apps/web/src/features/marketing/landing/faq.tsx:47`).
Two lines below it in the same file, `ACTION_PREVIEW_CLAIM` says the app
shows "a sample when available" and "the final number can change if new
email arrives first." Both are labeled canonical product-truth copy in the
same file's header comment, and they contradict each other on precision.

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/copy/action-safety.test.ts`, add this assertion
inside the existing first `it` block (the one already testing
`ACTION_SAFETY_SUMMARY`), right after the existing
`expect(ACTION_SAFETY_SUMMARY).toContain('Before a manual action moves email')` line:

```typescript
    // QA-sign-in-20260829-01: this sentence used to say "you see exactly
    // which emails are affected", contradicting ACTION_PREVIEW_CLAIM's own
    // "a sample when available ... the final number can change" two lines
    // below it in this same file. Both are canonical product-truth copy;
    // they must not disagree on precision.
    expect(ACTION_SAFETY_SUMMARY).not.toMatch(/exactly which/i);
    expect(ACTION_SAFETY_SUMMARY).toContain('the count and what changes in Gmail');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/shared test -- action-safety.test.ts`
Expected: FAIL — `ACTION_SAFETY_SUMMARY` still contains "exactly which" and
does not contain "the count and what changes in Gmail".

- [ ] **Step 3: Fix the copy**

In `packages/shared/src/copy/action-safety.ts`, change the first sentence of
`ACTION_SAFETY_SUMMARY` from:

```typescript
  'Before a manual action moves email, you see exactly which emails are affected. You can undo Archive, Later, and Delete from Activity until the deadline shown there. Deleted email also stays in Gmail Trash for up to 30 days unless you empty Trash sooner. A sent unsubscribe request cannot be taken back. Before an Autopilot rule starts, you see what it would do to email already in your inbox; you choose whether it acts or collects matches for your approval.';
```

to:

```typescript
  'Before a manual action moves email, you see the count and what changes in Gmail. You can undo Archive, Later, and Delete from Activity until the deadline shown there. Deleted email also stays in Gmail Trash for up to 30 days unless you empty Trash sooner. A sent unsubscribe request cannot be taken back. Before an Autopilot rule starts, you see what it would do to email already in your inbox; you choose whether it acts or collects matches for your approval.';
```

Only that clause changes. Every other sentence in the constant is untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/shared test -- action-safety.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full scoped suite for every consumer**

Run: `pnpm --filter @declutrmail/shared test && pnpm --filter @declutrmail/web test -- faq`
Expected: PASS. (The FAQ JSON-LD test asserts the rendered FAQ answer
matches the source string verbatim — it will pass automatically since it
reads `ACTION_SAFETY_SUMMARY` live, not a hardcoded copy.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/copy/action-safety.ts packages/shared/src/copy/action-safety.test.ts
git commit -m "fix(marketing): stop claiming exact affected-email precision (QA-sign-in-01)"
```

---

### Task 2: Fix the OAuth scope disclosure undersell (QA-sign-in-20260829-02)

**Files:**
- Modify: `packages/shared/src/copy/privacy.ts:63-64`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. `OAUTH_SCOPE_DISCLOSURE` stays a `string` export;
  every consumer (`beta/page.tsx`, `footer.tsx`, `story-shell.tsx` ×2,
  `pricing-screen.tsx`, `inbox-simulator-screen.tsx` ×3, `hero.tsx`,
  `comparison-screen.tsx`) picks up the new text automatically.

**Problem:** The current text — "Google will ask permission for DeclutrMail
to organize your Gmail" — undersells the actual `gmail.modify` grant, whose
own code comment
(`apps/api/src/auth/google-oauth.service.ts:7-11`) says it "covers both" read
and send/compose capability. `/security#oauth-scopes` already admits the
scope is "broader than what DeclutrMail uses," but that admission never
reaches the pre-consent click itself. No test exists that pins the current
string verbatim (`grep -rn "OAUTH_SCOPE_DISCLOSURE" apps/web/src
--include="*.test.tsx"` returns nothing), so this is a content-only change
with no test to update.

- [ ] **Step 1: Change the constant**

In `packages/shared/src/copy/privacy.ts`, change:

```typescript
export const OAUTH_SCOPE_DISCLOSURE =
  `Google will ask permission for DeclutrMail to organize your Gmail. ${PRIVACY_BADGE_HEADLINE}` as const;
```

to:

```typescript
export const OAUTH_SCOPE_DISCLOSURE =
  `Google's screen asks for one permission, gmail.modify, and words it more broadly than DeclutrMail uses it: DeclutrMail moves and labels email and never sends email as you. ${PRIVACY_BADGE_HEADLINE}` as const;
```

(This is the `usability-editor`'s suggested replacement from the original QA
run, applied verbatim; `PRIVACY_BADGE_HEADLINE` stays interpolated at the end
exactly as before, since that's a separate constant this finding does not
touch.)

- [ ] **Step 2: Run the scoped suite**

Run: `pnpm --filter @declutrmail/shared test && pnpm --filter @declutrmail/web test`
Expected: PASS. (Confirms nothing anywhere pinned the old string — if a test
fails, read it before assuming it's wrong; a failure here is new information,
not a false positive to route around.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/copy/privacy.ts
git commit -m "fix(marketing): disclose the real gmail.modify grant before consent (QA-sign-in-02)"
```

---

### Task 3: Don't auto-open the plan-change panel for the plan a subscriber already has (QA-sign-in-20260829-03)

**Files:**
- Modify: `apps/web/src/features/billing/plan-picker.tsx:279-284`
- Modify: `apps/web/src/features/billing/billing-screen.test.tsx`

**Interfaces:**
- Consumes: `PlanPickerProps.currentTier: TierId` (already a prop, already
  threaded into this component — no new prop).
- Produces: nothing new.

**Problem:** The deep-link effect that auto-opens the confirm panel
(`setSelected(intentPlan)`) never checks `currentTier`. The clearest
concrete case: `?plan=pro&cycle=monthly` for a visitor who is ALREADY on
Pro auto-opens a "confirm your plan" panel for the plan they're already on —
confusing, and unrequested by anything the visitor just clicked. It is not
destructive (D226-compliant preview, "Keep current plan" offered), so this
is a P2 UX fix, not a safety fix.

**Resolution of an ambiguity in the original finding's regression-test
wording:** the worklist row's own draft test text ("does NOT auto-expand
when `currentTier !== intentPlan`") would, read literally, disable the
entire pricing-CTA-to-confirm-panel flow, since every legitimate upgrade
click has `currentTier !== intentPlan` by definition. That contradicts the
finding's own prose, which describes the problem as opening "for an
existing paying subscriber" landing on the plan they already have. Per
CLAUDE.md §1.1 ("if genuinely unclear, state assumptions explicitly, proceed
if low-stakes"): this task guards the redundant case only —
`intentPlan === currentTier` — which is the literal defect described, is
low-stakes, reversible, and leaves every real upgrade/downgrade deep link
(where tiers differ) working exactly as it does today, matching the
existing test at `billing-screen.test.tsx:490-497`
("a deep-linked intent opens the confirm step with the exact plan and
cycle").

- [ ] **Step 1: Write the failing test**

In `apps/web/src/features/billing/billing-screen.test.tsx`, inside the
`describe('BillingScreen — paid subscriber', ...)` block (the one already
using `mockTier = 'pro'` and `PRO_SUB`), add:

```typescript
  it('a deep link naming the subscriber\'s own current tier does not auto-open the confirm panel', async () => {
    mockTier = 'pro';
    stubSubscription(() => jsonOk({ data: PRO_SUB }));
    renderScreen({ plan: 'pro', cycle: 'monthly' });

    await screen.findByTestId('current-plan-card');
    expect(screen.queryByTestId('checkout-panel')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web test -- billing-screen.test.tsx`
Expected: FAIL — the checkout panel renders even though `plan=pro` matches
the subscriber's existing Pro tier.

- [ ] **Step 3: Add the guard**

In `apps/web/src/features/billing/plan-picker.tsx`, change:

```typescript
  useEffect(() => {
    if (intentPlan && !disabled && !consumedIntent.current) {
      consumedIntent.current = true;
      setSelected(intentPlan);
    }
  }, [intentPlan, disabled]);
```

to:

```typescript
  useEffect(() => {
    // QA-sign-in-20260829-03: a deep link naming the tier the visitor is
    // already on (e.g. a stale bookmarked/shared pricing link) must not
    // auto-open a "confirm your plan" panel for the plan they already
    // have — nothing changed, so there is nothing to confirm. A deep link
    // naming a DIFFERENT tier still opens normally; that's the intended
    // upgrade/downgrade flow.
    if (intentPlan && intentPlan !== currentTier && !disabled && !consumedIntent.current) {
      consumedIntent.current = true;
      setSelected(intentPlan);
    }
  }, [intentPlan, currentTier, disabled]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web test -- billing-screen.test.tsx`
Expected: PASS — including the pre-existing
"a deep-linked intent opens the confirm step with the exact plan and cycle"
test, which must still pass unchanged (it uses a free-tier subscriber, so
`intentPlan !== currentTier` stays true there).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/billing/plan-picker.tsx apps/web/src/features/billing/billing-screen.test.tsx
git commit -m "fix(billing): stop auto-opening the confirm panel for a subscriber's own tier (QA-sign-in-03)"
```

---

### Task 4: State the Free-tier cleanup cap where visitors decide if Free fits (QA-sign-in-20260829-05)

**Files:**
- Modify: `apps/web/src/features/marketing/landing/hero.tsx`
- Modify: `apps/web/src/app/(marketing)/page.test.tsx`

**Interfaces:**
- Consumes: `TIER_MANIFEST.free.cleanupActionsPerMonth: number` (already
  exported from `@declutrmail/shared/entitlements`).
- Produces: nothing new.

**Problem:** The homepage hero's Free-tier disclaimer — "Free · no card ·
{N}-day undo on Archive, Later and Delete" — never mentions the 50
cleanup-action/month cap (`TIER_MANIFEST.free.cleanupActionsPerMonth`),
which only appears in the pricing teaser further down the page. A visitor
deciding whether Free fits their inbox size sees an incomplete picture at
the exact decision point.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/app/(marketing)/page.test.tsx` (after the existing
`describe('Hero subhead — ...')` block):

```typescript
describe('Hero disclaimer — states the Free-tier cap (QA-sign-in-05)', () => {
  it('mentions the monthly cleanup-action cap alongside the undo window', () => {
    render(<Hero />);
    const disclaimer = screen.getByText(/no card/i);
    expect(disclaimer.textContent).toMatch(/50 cleanup actions a month/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web test -- page.test.tsx`
Expected: FAIL — the disclaimer text does not yet mention a cleanup cap.

- [ ] **Step 3: Update the disclaimer and its import**

In `apps/web/src/features/marketing/landing/hero.tsx`, change the import:

```typescript
import { MIN_UNDO_WINDOW_DAYS } from '@declutrmail/shared/entitlements';
```

to:

```typescript
import { MIN_UNDO_WINDOW_DAYS, TIER_MANIFEST } from '@declutrmail/shared/entitlements';
```

Then change:

```jsx
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
            Free · no card · {MIN_UNDO_WINDOW_DAYS}-day undo on Archive, Later and Delete
          </p>
```

to:

```jsx
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
            Free · no card · {TIER_MANIFEST.free.cleanupActionsPerMonth} cleanup actions a month ·{' '}
            {MIN_UNDO_WINDOW_DAYS}-day undo on Archive, Later and Delete
          </p>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web test -- page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/landing/hero.tsx "apps/web/src/app/(marketing)/page.test.tsx"
git commit -m "fix(marketing): state the Free cleanup cap beside the homepage disclaimer (QA-sign-in-05)"
```

---

### Task 5: Add a low-key link from the homepage to `/sign-in`'s pre-consent explanation (QA-sign-in-20260829-06)

**Files:**
- Modify: `apps/web/src/features/marketing/landing/hero.tsx`
- Modify: `apps/web/src/features/marketing/landing/landing.css`
- Modify: `apps/web/src/app/(marketing)/page.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**Problem:** `/sign-in` is a fully-built, privacy-itemized pre-consent
explanation page, but it's unreachable from any nav link by design
(`public-shell.test.tsx:40` pins zero nav links to it — that pin is
untouched by this task, since this adds a link on the homepage hero, not
the nav). The scared-user persona never sees this page before clicking
through to Google. This task implements the original finding's own
suggested idea: a low-key link under the homepage disclaimer.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/app/(marketing)/page.test.tsx`:

```typescript
describe('Hero — links to the pre-consent explanation page (QA-sign-in-06)', () => {
  it('offers a low-key link to /sign-in beside the OAuth disclosure', () => {
    render(<Hero />);
    const link = screen.getByRole('link', { name: /what DeclutrMail can and can.t access/i });
    expect(link).toHaveAttribute('href', '/sign-in');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web test -- page.test.tsx`
Expected: FAIL — no such link exists yet.

- [ ] **Step 3: Add the link**

In `apps/web/src/features/marketing/landing/hero.tsx`, change:

```jsx
          {/* Connect CTAs link straight to Google's consent screen, so the
              permission explanation stays beside the click. */}
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">{OAUTH_SCOPE_DISCLOSURE}</p>
```

to:

```jsx
          {/* Connect CTAs link straight to Google's consent screen, so the
              permission explanation stays beside the click. */}
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">{OAUTH_SCOPE_DISCLOSURE}</p>
          <p className="dm-mkt-hero-note dm-mkt-reveal-4 dm-mkt-reveal">
            <a href="/sign-in">See what DeclutrMail can and can&rsquo;t access →</a>
          </p>
```

- [ ] **Step 4: Add the link's CSS**

In `apps/web/src/features/marketing/landing/landing.css`, immediately after
the existing `.dm-mkt-hero-note { ... }` rule, add:

```css
.dm-mkt-hero-note a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.dm-mkt-hero-note a:hover,
.dm-mkt-hero-note a:focus-visible {
  color: var(--mkt-ink);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web test -- page.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/marketing/landing/hero.tsx apps/web/src/features/marketing/landing/landing.css "apps/web/src/app/(marketing)/page.test.tsx"
git commit -m "feat(marketing): link the homepage to /sign-in's pre-consent detail (QA-sign-in-06)"
```

---

### Task 6: Stop promising a scan duration the sync gate deliberately withholds (QA-sign-in-20260829-07)

**Files:**
- Modify: `apps/web/src/features/marketing/auth-entry/auth-entry.tsx`
- Modify: `apps/web/src/features/marketing/auth-entry/auth-entry.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**Problem:** `/sign-in` step 2 says "The first scan can take a few minutes
for an older mailbox" — a duration claim the product's own sync gate
deliberately refuses to state anywhere else
(`sync-gate.test.tsx:92` pins that no minute figure is ever shown, because
duration varies too widely to promise honestly).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/marketing/auth-entry/auth-entry.test.tsx`:

```typescript
describe('AuthEntry step copy (QA-sign-in-07)', () => {
  it('does not promise a scan duration the sync gate withholds elsewhere', () => {
    render(<AuthEntry />);
    expect(screen.queryByText(/a few minutes/i)).not.toBeInTheDocument();
    expect(screen.getByText(/we email you when your inbox is ready/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web test -- auth-entry.test.tsx`
Expected: FAIL — the current copy still promises "a few minutes".

- [ ] **Step 3: Fix the copy**

In `apps/web/src/features/marketing/auth-entry/auth-entry.tsx`, change:

```jsx
            <div>
              <span>2</span>
              <p>
                <strong>DeclutrMail groups your email by sender.</strong>
                The first scan can take a few minutes for an older mailbox.
              </p>
            </div>
```

to:

```jsx
            <div>
              <span>2</span>
              <p>
                <strong>DeclutrMail groups your email by sender.</strong>
                The first scan runs on its own — we email you when your inbox is ready.
              </p>
            </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web test -- auth-entry.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/auth-entry/auth-entry.tsx apps/web/src/features/marketing/auth-entry/auth-entry.test.tsx
git commit -m "fix(marketing): stop promising a scan duration the sync gate withholds (QA-sign-in-07)"
```

---

### Task 7: Rewrite the `inbox_limit` recovery alert in plain language (QA-sign-in-20260829-09)

**Files:**
- Modify: `apps/web/src/features/marketing/auth-entry/auth-entry.tsx`
- Modify: `apps/web/src/app/(marketing)/sign-in/page.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

**Problem:** The `inbox_limit` alert is a 3-instruction run-on sentence that
leaks internal terms ("workspace", "inbox slot") a first-timer landing on
this error state has no context for. This is the SAME alert the existing
test at `apps/web/src/app/(marketing)/sign-in/page.test.tsx:16-26` already
covers — this task updates that test's assertions to the new copy rather
than adding a new test, since the existing test already owns this
component's contract.

- [ ] **Step 1: Update the test to the new copy (write it failing first)**

In `apps/web/src/app/(marketing)/sign-in/page.test.tsx`, change:

```typescript
  it('explains the closed inbox-limit recovery without requiring a session', async () => {
    await renderPage({ auth_result: 'inbox_limit' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/this Gmail can’t reconnect yet/i);
    expect(alert).toHaveTextContent(/sign in with another Gmail that is still connected/i);
    expect(alert).toHaveTextContent(/free an inbox slot or review your plan options/i);
    expect(screen.getByRole('link', { name: /compare plans/i })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });
```

to:

```typescript
  it('explains the closed inbox-limit recovery without requiring a session', async () => {
    await renderPage({ auth_result: 'inbox_limit' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/this Gmail can’t reconnect yet/i);
    expect(alert).toHaveTextContent(/your plan connects one Gmail account/i);
    expect(alert).toHaveTextContent(/another one is using it/i);
    expect(alert).toHaveTextContent(/sign in with that connected account to disconnect it/i);
    expect(alert).toHaveTextContent(/upgrade to connect more/i);
    expect(screen.getByRole('link', { name: /compare plans/i })).toHaveAttribute(
      'href',
      '/pricing',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @declutrmail/web test -- "apps/web/src/app/(marketing)/sign-in/page.test.tsx"`
Expected: FAIL — the current alert copy doesn't match the new assertions.

- [ ] **Step 3: Fix the copy**

In `apps/web/src/features/marketing/auth-entry/auth-entry.tsx`, change:

```jsx
          {authResult === 'inbox_limit' ? (
            <div className="dm-auth-entry-alert" role="alert">
              <strong>This Gmail can’t reconnect yet.</strong>
              <p>
                This Gmail is disconnected, and its workspace’s inbox limit is already in use. Sign
                in with another Gmail that is still connected, then free an inbox slot or review
                your plan options before reconnecting this one.
              </p>
              <TrackedCta href="/pricing" cta="see_pricing" placement="hero">
                Compare plans →
              </TrackedCta>
            </div>
          ) : null}
```

to:

```jsx
          {authResult === 'inbox_limit' ? (
            <div className="dm-auth-entry-alert" role="alert">
              <strong>This Gmail can’t reconnect yet.</strong>
              <p>
                Your plan connects one Gmail account, and another one is using it. Sign in with
                that connected account to disconnect it, or upgrade to connect more.
              </p>
              <TrackedCta href="/pricing" cta="see_pricing" placement="hero">
                Compare plans →
              </TrackedCta>
            </div>
          ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @declutrmail/web test -- "apps/web/src/app/(marketing)/sign-in/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/marketing/auth-entry/auth-entry.tsx "apps/web/src/app/(marketing)/sign-in/page.test.tsx"
git commit -m "fix(marketing): plain-language the inbox_limit recovery alert (QA-sign-in-09)"
```

---

## Final Notes

After all 7 tasks land, update `docs/qa/qa-worklist.md`'s `## sign-in`
section (a separate, non-code step — not part of any task's diff, since the
worklist is append/move-only per its own rules): move QA-01, -02, -03, -05,
-06, -07, -09 from `Open` to `Fixing` → `PR #<n>` once the branch is pushed,
and record QA-08 as `Gone` (citing the PR #637 commit that already fixed it,
predating this finding). Leave QA-04 and QA-10 `Open` with the scope-decision
rationale from this plan's header. This update happens once the PR exists,
not before — the worklist's own rule is "no answer is a complete outcome and
the row stays Open" until a founder or a later run confirms the merge.
