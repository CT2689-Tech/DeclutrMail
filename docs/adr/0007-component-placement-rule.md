# ADR-0007: Component placement — lazy promotion + spec override

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** chintan.a.thakkar@gmail.com, frontend-foundation agent
- **Related D-decisions:** D199 (lazy promotion + spec override), D198
  (headless hooks), D173 (`packages/shared` is the contract layer)

## Context

PR 3 will seed Storybook and the first golden screens. PRs 4–N then
fan out across `triage`, `senders`, `activity`, `brief`, `screener`,
`autopilot`, `settings`, `billing`, `onboarding`, `quiet`,
`followups`, `snoozed` — twelve features built largely by parallel
agents over weeks. Two failure modes are likely if placement is left
to per-PR judgment:

1. **Premature abstraction.** An agent building Feature A invents a
   "future-proof" component shape on day 1 for unknown consumers. The
   shape ossifies, then Feature B needs slightly different
   ergonomics, the shape grows a prop, a year later it is a
   god-object with 23 booleans.
2. **Silent duplication.** Two agents in parallel worktrees ship the
   same component into their own feature directory without seeing each
   other's PR. We then live with two slightly-different `<UndoLink>`
   implementations until someone notices.

D199 settles the rule. This ADR captures the rule **in the repo** —
the plan body is long-form rationale; the ADR is the operational
contract an agent reads in 90 seconds before opening a PR.

The plan also acknowledges that this rule's enforcement
(`architecture-guardian` AST-similarity grep) is deferred. Until that
agent ships, the rule is enforced by reviewer attention plus the
checklist in §Implementation notes.

## Decision

We adopt **lazy promotion with spec override** for components,
utilities, types, and Zod schemas:

1. **Default (lazy):** Components, utilities, types, and schemas live
   in `apps/{web,api,worker}/src/features/{feature}/` while they have
   exactly one consumer. The PR that introduces the second consumer
   does the promotion to `packages/shared/`. Both consumers' imports
   are updated in that same PR; the barrel is updated; a file-header
   comment names the consumers and the originating PR.
2. **Override (spec):** When a D-decision explicitly names ≥2
   consumers for a primitive — or names the primitive as a trust /
   safety / brand-locked surface — the primitive is **pre-promoted**
   into `packages/shared/` from day 1. The file header cites the
   D-decision so the rationale lives next to the code.
3. **Hooks are out of scope.** Per D198, behavior hooks always live
   in `packages/shared/src/hooks/`. This ADR governs rendering
   surfaces only.

## Alternatives considered

- **Eager promotion (everything starts in `packages/shared/`):**
  rejected because it forces speculative API design before the second
  consumer's actual needs are known. Each promoted primitive then
  accrues props the original author guessed at.
- **No shared layer (every feature owns everything):** rejected because
  silent duplication compounds. Two `<UndoLink>` variants drift over
  six months and we lose the "uniformly premium" feel D130 trades on.
- **Three-strikes promotion (wait for the third consumer):** rejected
  because by the third consumer the shape has frequently diverged
  beyond easy unification. The second consumer is the right moment
  to lock the shape — the cost is still small, and the shared shape
  is still actually shared.

## Consequences

### Positive

- Each feature ships the simplest possible component locally, then
  pays a small refactor tax exactly at the moment unification
  actually pays back.
- The spec override keeps trust / safety / brand-locked surfaces
  (e.g., the `PrivacyBadge` per D7+D228, the `RecommendationBadge`
  per D36/D39/D50) authoritative from day 1.
- Per-file `// Consumers:` headers give future agents a one-glance
  read of who depends on a primitive before they change its API.

### Negative

- A second-consumer PR is slightly larger than it would otherwise be —
  it carries the move-and-rewire diff in addition to the feature
  work. Reviewers must accept that cost as the price of locking the
  API at the right moment.
- Until `architecture-guardian` ships (D199 enforcement), parallel
  worktrees can briefly miss each other and we may detect the
  duplicate at merge time instead of PR-open time. A grep before
  starting a worktree mitigates this (see §Implementation notes).

### Neutral

- This rule is orthogonal to where state lives (D200 splits
  TanStack-Query server state from Zustand client state). A primitive
  promoted to `packages/shared/` may still receive its data from a
  feature-local query hook.

## Implementation notes

**File-header template** (copy this when promoting or pre-promoting):

```typescript
// packages/shared/src/components/<name>.tsx
//
// Promoted to packages/shared/ in PR #<n> per D199 (lazy promotion).
// Consumers:
//   - apps/web/src/features/<feature-A>/...
//   - apps/web/src/features/<feature-B>/...
//
// Shape locked at promotion. Breaking changes require an ADR
// and a multi-feature PR. New props must list which consumer needs
// them in the PR description.
```

**Promotion checklist** (the second-consumer PR must satisfy all):

- [ ] File moved to `packages/shared/src/components/<kebab>.tsx`
- [ ] File-header comment present with D-citation and consumer list
- [ ] Both features' imports updated to `@declutrmail/shared`
- [ ] `packages/shared/src/index.ts` barrel exports the primitive
- [ ] No feature business vocabulary in props (no `senderKey`,
      `triageVerb`, etc. inside `packages/shared/`)
- [ ] Test colocated with the primitive (mirror the
      `privacy-badge.test.tsx` pattern — SSR-only assertions until
      jsdom is wired)

**Pre-promotion pointer list** (primitives spec-named as pre-promoted
in the plan today, per D199 worked-examples table):

| Primitive                                                                          | Source D-decision        | Why pre-promoted                                                      |
| ---------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- |
| Universal leaf primitives (`<Button>`, `<Input>`, `<Chip>`, `<Modal>`, `<Drawer>`) | design system foundation | Universal; no shared-shape spec needed                                |
| `<ConditionChip>`                                                                  | D197                     | Spec names ≥3 consumers (Senders D51, Activity D56, Autopilot custom) |
| `<FieldOperatorValue>`                                                             | D197                     | Same                                                                  |
| `<DragReorderList>`                                                                | D197                     | Notification reordering, Pinned senders, Quiet schedule               |
| `<TriggerSelector>`                                                                | D197                     | Brief schedule (D64), Quiet schedule (D92)                            |
| `<RecommendationBadge>`                                                            | D36, D39, D50            | Spec names ≥3 consumers                                               |
| `<PrivacyBadge>`                                                                   | D7, D228                 | Trust artifact — locked copy, locked surface                          |

**Recon discipline before starting a feature PR** (mitigates the
parallel-worktree duplication risk until `architecture-guardian`
ships): when adding any non-trivial component to a feature, grep
unfiltered across the repo first —

```bash
grep -rn '<ComponentName' --exclude-dir=node_modules --exclude-dir=.git .
```

If a similar component exists in another feature, this is a
candidate for same-PR promotion. Per MISTAKES.md's 2026-05-20
rename-recon entry, do not scope the grep with `--include` filters.

## References

- D198 — headless hooks for behavior, feature-owned components for
  rendering (`docs/execution/Implementation-Plan.md`, line ~5638)
- D199 — lazy promotion + spec override (`docs/execution/Implementation-Plan.md`,
  line ~5857)
- D173 — `packages/shared` is the contract layer, web+mobile both
  consume it
- D130 — "feels uniformly premium" positioning that depends on
  behavioral and visual consistency across features
- ADR-0003 — sibling ADR for the worker layer's framework-agnostic
  base class — a precedent for "shared interface, feature-owned
  implementation" patterns in this codebase
