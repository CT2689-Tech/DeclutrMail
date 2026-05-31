# Bulk Actions — Final Consensus (post-Codex)

**Author:** Claude (session 2026-05-30)
**Status:** Design locked. Implementation deferred to next session. PR #135 MERGED (squash `ce00ad1`, 2026-05-31).
**Predecessor:** `docs/handoffs/2026-05-30-bulk-actions-architecture-codex-review.md` (proposal sent to Codex)

This doc is the FINAL design after Codex review + founder ack. Next session starts here.

---

## 1. State today (end of 2026-05-30 session)

### Shipped on `chore/bootstrap-senders-counter` — MERGED as squash `ce00ad1`

- Slice 1 Steps 1–7a complete (9 commits squashed; final tree +3598/-140 across 32 files)
- SenderTable wired into Senders screen behind D49 view toggle
- Sort state in Zustand, plumbed to API via `?sort=&direction=`
- Mobile (<sm) forces Grid via `useIsAtMost('sm')`
- K/A/U/L verbs bridge to existing `ConfirmActionModal` (FAKE — toast only, no API)
- Counter reconciliation cron wired (24h interval)
- UndoExpiry cron wired (5min interval, was unwired since PR #131)

### NOT shipped (next session)

- Real `performAction` API wire
- Action Registry manifest (PR #136)
- `later`, `unsubscribe`, `unarchive` verbs
- `multi-sender` + `sender-filter` selectors
- Free 5-lifetime-cleanup reservation table
- Premium FE pass (letter-strip + Senders Lab pick)

---

## 2. Final design decisions (founder-acked)

### 2.1 Action Registry (formerly "Action Manifest")

ONE typed descriptor per verb in `packages/shared/actions/`. Source of truth for label change, microcopy, tier capabilities per selector, eligibility, preview shape, pipeline routing.

**Codex correction A — DB enum NOT derived from manifest.** Pure constants module:

```
packages/shared/contracts/verb-constants.ts   # pure string-literal arrays
  ↓ imported by ↓
packages/db/schema/action-jobs.ts            # explicit pg_enum migration
packages/shared/actions/manifest-entries.ts  # rich descriptors
```

**Codex correction B — Discriminated `execution.kind`:**

```typescript
execution:
  | { kind: 'label-modify'; buildLabelChange: (params: ParamsForVerb<V>) => { forward: LabelChange; reverse: LabelChange } }
  | { kind: 'policy-only';  buildPolicyWrite:  (params: ParamsForVerb<V>) => PolicyDelta }
  | { kind: 'unsubscribe';  resolveMethod: (sender) => { method: 'one-click' | 'mailto'; href: string }; sideEffect: { addLabelIds: ['DeclutrMail/Unsubscribed'] } }
  | { kind: 'snooze'; ... }
  | { kind: 'send'; ... }     // V2.1
```

**Codex correction C — `capabilitiesBySelector`, not single `tier`:**

```typescript
capabilities: {
  readonly 'sender':         { tier: 'free' | 'plus' | 'pro'; countsAsCleanup: boolean };
  readonly 'multi-sender':   { tier; cap: number; countsAsCleanup };
  readonly 'sender-filter':  { tier; countsAsCleanup } | null;  // null = unsupported
}
```

**Founder push-back A (accepted) — `preview` 3-value:**

```typescript
preview: 'modal' | 'inline-confirm' | 'silent';
```

- archive/later/unsubscribe/trash → `'modal'`
- keep/protect → `'inline-confirm'` (200ms toast w/ 5s undo)
- silent = never user-triggered; reserved for autopilot rule-fire

**Founder push-back B (accepted) — `affectedCount` = attempted:**

Worker records `attempted = ids.length`. No pre-state read to compute `noOpCount`. `noOpCount` is worker observability metric (D159 log line) only. Receipt shows attempted. Drift between selection-count and attempted surfaces only on selector-resolution mismatch (sender no longer in mailbox, etc.).

### 2.2 Six product decisions (Q-set 1)

| Q                          | Pick                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Q1 Tier gating             | Free single-sender + 5-lifetime; Plus multi-sender cap 1000; Pro adds sender-filter + 30d undo                       |
| Q2 Long-tail bulk          | Single action_job; 25k soft cap; auto-split banner above                                                             |
| Q3 Bulk-unsubscribe mailto | Pre-flight split count + per-sender "Open in Gmail" CTA list — **NOT auto-open tabs** (D230 strict; Codex Concern 1) |
| Q4 Preview phasing         | multi-sender single-phase; sender-filter two-phase with **snapshot** previewToken (Codex correction §10.4)           |
| Q5 Undo tray grouping      | One tray entry per bulk; deep-link to Activity for per-sender                                                        |
| Q6 Activity log volume     | Per-sender storage + `bulk_action_job_id` FK; display grouped                                                        |

### 2.3 Four follow-on decisions (Q-set 2)

| Q                                 | Pick                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 Truth counts                   | Always `attempted` post-execution; no `noOp` user-surfacing                                                                            |
| Q2 509-sender row distribution    | 1 undo_journal · 1 action_jobs · 509 activity_log · 1 tray · 1 Activity card                                                           |
| Q3 Single-sender undo within bulk | NEW `unarchive` forward verb (not partial undo); Sender Detail surfaces "Restore from bulk"                                            |
| Q4 Architecture scope             | ADR-0015 = **Action Registry** (not just Label-Modify Pipeline) — covers policy-only + unsubscribe + label-modify + future snooze/send |

### 2.4 Eight Codex calls

| Codex §                   | Verdict                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------- |
| §10.1 manifest at 4 verbs | GO; constants module separate from descriptor                                       |
| §10.2 keep/protect        | GO same registry, `execution.kind` discriminates                                    |
| §10.3 archiveHistoric     | per-verb typed params + pure `buildLabelChange(params)` helper                      |
| §10.4 preview drift       | snapshot resolved IDs behind previewToken, 10-min TTL, 409/410 on expiry            |
| §10.5 free counter        | reservation table + idempotent state machine (`reserved` / `consumed` / `refunded`) |
| §10.6 shortcut            | `event.key`, +`aria-keyshortcuts`, no `code`                                        |
| §10.7 sequencing          | single-sender real wire first, multi-sender second                                  |
| §10.8 worker lock         | hold (D203 perMailboxPolicy = 1)                                                    |

### 2.5 Codex risk corrections (all accepted)

| Concern                                 | Correction landed                                                |
| --------------------------------------- | ---------------------------------------------------------------- |
| §3 Q3 mailto auto-open contradicts D230 | per-sender CTA list, no sequence                                 |
| §5 tier+bulkMode unsafe                 | `capabilitiesBySelector`                                         |
| §5/§8 preview optional                  | `preview: 'modal' \| 'inline-confirm' \| 'silent'` typed         |
| §4 affectedCount semantics              | attempted-only (founder push-back B)                             |
| §4 cite D232 for atomic undo            | cite D35 + D58 + undo_journal `reverted_at IS NULL`              |
| §4 unsubscribe misclassified            | separate `execution.kind: 'unsubscribe'`                         |
| §5.5 DB importing manifest              | constants module + manifest descriptor split                     |
| §7 worker change not minimal            | local-label mirror + activity row count need verb-aware rewrites |
| §3 Q6 D235 covers activity_log          | separate index plan + retention metric tracking                  |

---

## 3. Premium FE pass (next session)

### 3.1 Letter-strip from visible labels

D227 mandates canonical VERBS + shortcuts. Does NOT mandate visible letters next to button text. Premium apps (Linear, Superhuman, Notion) keep shortcuts INVISIBLE — only revealed on hover / `?` cheat sheet / modal hint.

Surfaces to clean:

| Surface                   | Today                        | Next session                                                      |
| ------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| SenderTable verb column   | "K · A · U · L" letter chips | "Archive" "Later" "Unsubscribe" buttons (no letters)              |
| SelectionBar              | Buttons w/ shortcut chips    | Buttons only; shortcut in tooltip                                 |
| ConfirmActionModal footer | `Cancel · Confirm`           | `Cancel ⌫ · Confirm ⌘↵` (subtle, secondary text color)            |
| Keyboard cheat sheet      | doesn't exist                | `?` toggle reveals manifest-derived shortcut list                 |
| Onboarding tour           | hardcoded copy               | derives from `manifest[verb].copy` + shows shortcut once per verb |

Implementation:

- Manifest `copy.primary` already letter-free
- Manifest `shortcut` stays the source-of-truth at code layer
- `aria-keyshortcuts="A"` on Archive button (a11y) — invisible to sighted users
- New `<KeyboardCheatsheet />` component reads manifest on `?` press

### 3.2 Senders Lab redesign — pick + harden

Memory `[[senders-lab-premium-redesign]]`: throwaway `/senders-lab` route has 3 premium variants (Atelier / Cockpit / Concierge, light+dark). Founder pick = next session's first task before manifest wire. Pick informs:

- Visual density default for SenderTable
- Color discipline (palette restraint)
- Motion budget per surface
- Typography hierarchy (display vs sans vs mono)
- Component naming for D220 promotion candidates

Once picked, harden into main `apps/web/src/features/senders/` and delete `/senders-lab` route.

### 3.3 Premium baseline checklist (apply to every surface)

| Concern     | Rule                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| Typography  | Geist Sans for body, Geist Mono for tabular nums (counts, timestamps), Geist Display for hero only |
| Color       | ≤3 chromatic accents per screen; monochrome default                                                |
| Spacing     | 4px base grid; minimum 16px between adjacent surfaces; 24px around hero CTAs                       |
| Motion      | ≤220ms expand; ≤180ms collapse; no >250ms outside hero reveals                                     |
| Shadows     | One shadow recipe per elevation tier (3 tiers max)                                                 |
| Borders     | One stroke weight (0.5px or 1px, pick once); no mixed weights                                      |
| Iconography | Single icon set; one stroke style                                                                  |
| Counts      | Always `font-variant-numeric: tabular-nums` for stable column alignment                            |

---

## 4. PR sequence (next session forward)

| PR  | Branch | Scope | Session day |
| --- | ------ | ----- | ----------- |

> **Update 2026-05-31:** PR #135 MERGED as squash commit `ce00ad1`. Sequence
> numbers below are LABELS (P1, P2, …), not GitHub PR numbers — GitHub
> assigns actual numbers in submission order and other unrelated PRs may
> land between these. PR #136 on GitHub is `feat(security-events)`, not
> P1 below.

| Label        | Branch                                               | Scope                                                                                                                                                                                                         | Session day |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **(merged)** | `chore/bootstrap-senders-counter` → squash `ce00ad1` | Slice 1 Steps 1–7a — shipped 2026-05-31                                                                                                                                                                       | Day 1       |
| **P1**       | `feat/senders-lab-pick-hardening`                    | Founder pick from senders-lab; harden into main; delete lab route; apply premium baseline checklist                                                                                                           | Day 2 a.m.  |
| **P2**       | `feat/action-registry-foundation`                    | ADR-0015 (Action Registry) + constants module + manifest module + 5 invariant tests. Zero consumers.                                                                                                          | Day 2 p.m.  |
| **P3**       | `refactor/worker-reads-registry`                     | LabelActionWorker switches on `execution.kind`; PolicyActionWorker added; `VERB_LABEL_CHANGES` deleted; per-verb `buildLabelChange` invoked.                                                                  | Day 3       |
| **P4**       | `refactor/web-reads-registry`                        | SelectionBar / ConfirmActionModal / SenderTable / senders-screen consume manifest. Letter-strip in same PR (cohesive UX delta). KeyboardCheatsheet component.                                                 | Day 3       |
| **P5**       | `feat/d226-bulk-verbs-schema`                        | `later`, `unsubscribe`, `unarchive` verbs (constants + manifest entries + explicit pg_enum migration + `verbParams jsonb` + `activity_log.bulk_action_job_id` FK + index + cleanup_action_reservations table) | Day 4       |
| **P6**       | `feat/d226-real-single-sender-wire`                  | `useEnqueueAction` + `useActionStatus` + idempotency util; senders-screen wires REAL API for SINGLE-sender K/A/U/L. Replaces fake `performAction`.                                                            | Day 4       |
| **P7**       | `feat/d226-multi-sender-bulk`                        | `multi-sender` selector + capability gate + reservation table integration + `@RequiresCapability(verb, selectorType)` decorator                                                                               | Day 5       |
| **P8**       | `feat/d226-sender-filter-pro`                        | `sender-filter` selector + two-phase preview-snapshot endpoint + Select-All-Matching banner + Pro tier gate                                                                                                   | Day 5       |
| **P9**       | `feat/d230-mailto-batch-cta`                         | Bulk unsubscribe mailto handler — per-sender "Open in Gmail" list (D230 strict)                                                                                                                               | Day 6       |

Each PR independently shippable + smoke-testable. Sequence assumes ~1 PR per half-day at founder-supervised pace.

---

## 5. Tests to add as invariants (per Codex §10 + Concerns)

| Test                                                                       | Asserts                      |
| -------------------------------------------------------------------------- | ---------------------------- |
| `every action_verb pg_enum value has manifest entry`                       | Sync between DB + registry   |
| `every D227 verb has correct shortcut`                                     | K/A/U/L hardwired            |
| `every label-modify + unsubscribe verb has preview='modal'`                | D208/D226                    |
| `every policy-only verb has preview ∈ {'modal','inline-confirm'}`          | D208/D226                    |
| `no policy-only verb appears in LabelActionWorker dispatch`                | Pipeline isolation           |
| `capabilitiesBySelector tier monotonic: sender≤multi-sender≤sender-filter` | Free funnel coherence        |
| `cleanup_action_reservations: reserved → consumed/refunded are idempotent` | D19 counter race-safety      |
| `previewToken expiry returns 409, mismatched returns 410`                  | Preview snapshot integrity   |
| `unsubscribe.resolveMethod returns one-click for RFC 8058 senders`         | D230                         |
| `mailto path never auto-opens tabs in batch`                               | D230                         |
| `unarchive eligibility requires lastAction='archive' within undo window`   | Q3 forward-restore semantics |
| `bulk_action_job_id index covers Activity page filter query`               | D58 read pattern             |

---

## 6. Reference

- Plan: `~/.claude/plans/i-want-you-to-smooth-kahn.md`
- CLAUDE.md: `/Users/chintant/projects/DeclutrMail/CLAUDE.md`
- Predecessor doc (Codex review request): `docs/handoffs/2026-05-30-bulk-actions-architecture-codex-review.md`
- ADR-0014 (counter): `docs/adr/0014-senders-total-received-counter.md`
- Senders list contract: `docs/api/senders-list-contract.md`
- Existing action infra: `apps/api/src/actions/`, `packages/workers/src/label-action.worker.ts`, `packages/db/src/schema/{action-jobs,undo-journal,activity-log}.ts`
- Existing Senders UI: `apps/web/src/features/senders/`
- Senders Lab: `apps/web/src/app/senders-lab/` (memory `[[senders-lab-premium-redesign]]`)
- PR #135: `chore/bootstrap-senders-counter` — 8 commits, awaiting merge as-is

---

## 7. Next-session opening prompt template

```
Read docs/handoffs/2026-05-30-bulk-actions-final-consensus.md fully.
PR #135 is (merged | open — confirm). Start with PR #136 (senders-lab
pick + hardening). Confirm with founder which lab variant
(Atelier / Cockpit / Concierge) before component refactor begins.
Then proceed to PR #137 (Action Registry foundation).
```
