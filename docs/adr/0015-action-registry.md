# ADR-0015: Action Registry

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** founder, Claude (design session 2026-05-30), Codex (review round)
- **Related D-decisions:** D226 (action lifecycle: sheet → preview → mutation → undo), D227 (canonical verbs K/A/U/L + shortcuts), D208 (preview mandatory), D17–D21 + D77/D81 (tier gating + undo windows), D35/D58 (undo journal + tray), D42 (sender policies / protect), D203/D225 (worker policies), D7/D228 (privacy allowlist), D222 (no category prediction), D230 (mailto unsubscribe manual)
- **Supersedes naming:** "Action Manifest" (working name); ADR-0013 (destructive-action pipeline) is the sibling this generalizes.

## Context

DeclutrMail's destructive-action pipeline (ADR-0013) shipped with a single
verb — `archive`. Its label change lives in a `VERB_LABEL_CHANGES` map in
`packages/workers/src/label-action.worker.ts`, the FE renders K/A/U/L verbs
against a fake `performAction` (toast only, no API), and tier/preview/copy
rules are scattered across the worker, the API DTOs, and the web components.

The bulk-actions slice adds `later`, `unsubscribe`, and `unarchive`, plus
three selector axes (`sender`, `multi-sender`, `sender-filter`) and three
billing tiers. Without a single source of truth, every one of those facts —
the button label, the shortcut letter, whether a preview is a modal or an
inline confirm, which tier unlocks which selector, whether the verb draws
down the Free cleanup counter, and how to build the actual mutation — would
be re-encoded independently in the worker, the API, and the web, drifting the
moment any of them changes. The 4-verb threshold is exactly where a registry
earns its keep (LEARNINGS 2026-05-30: registries belong before the second
verb, not after the sixth).

Three forces shape the design, each a Codex correction accepted in the
2026-05-30 consensus:

- **A — the DB enum must not be derived from a JS object.** Postgres enum
  values are append-only and must be declared explicitly in a migration;
  generating them from a manifest object risks reorder/removal hazards
  (LEARNINGS 2026-05-30). The verb vocabulary is a shared _constant_, not a
  code-gen source.
- **B — one verb's execution is not another's.** `archive` modifies labels;
  `keep` writes a standing policy; `unsubscribe` resolves a one-click or
  mailto method. A single `LabelChange` field cannot model this.
- **C — capability is per selector, not global.** "Free" can do single-sender
  archive but not "archive all matching" — tier depends on the selector axis.

## Decision

We will introduce an **Action Registry**: ONE typed descriptor per verb, the
single source of truth for label change, microcopy, per-selector tier
capabilities, eligibility, preview surface, and pipeline routing. It is split
across two modules to honour correction A:

```
packages/shared/src/contracts/verb-constants.ts   # pure string-literal arrays (vocabulary)
  ↓ imported by ↓
packages/db/src/schema/action-jobs.ts             # explicit pg_enum migration (P5)
packages/shared/src/actions/manifest-entries.ts   # rich descriptors (the registry)
```

`verb-constants.ts` is pure TypeScript — no Zod, no logic, no cross-package
imports — so the DB package can adopt the vocabulary without pulling the
React/contract tree. The DB pg*enum lists its values explicitly and is
_verified* against the constants by an invariant test; it is never generated
from them.

Each descriptor (`ActionDescriptor<V>`) carries:

- `copy` — letter-free `primary` button label + `description` (§3.1: shortcut
  letters are invisible until the `?` cheatsheet).
- `shortcut` — the single-key D227 binding (K/A/U/L), bound to `event.key`
  (Codex §10.6), pinned by the `CANONICAL_SHORTCUTS` constant.
- `preview` — `'modal' | 'inline-confirm' | 'silent'` (founder push-back A:
  three values, not a boolean). Destructive verbs → modal; `keep` →
  inline-confirm; `silent` is reserved for Autopilot rule-fire (no V2 consumer).
- `capabilities` — `capabilitiesBySelector` (correction C): `{ sender,
multi-sender, sender-filter }`, each `{ tier, countsAsCleanup, cap? }` or
  `null` when the selector is unsupported.
- `execution` — a discriminated union on `kind` (correction B). Each variant
  carries a **pure** builder (no IO, no DB) that returns the mutation:
  `label-modify` → `buildLabelChange(params) → { forward, reverse }`;
  `policy-only` → `buildPolicyWrite(params) → PolicyDelta`. `unsubscribe`,
  `snooze`, and `send` append as their verbs land.

The registry type is a mapped type — `{ [V in ActionVerb]: ActionDescriptor<V> }`
— so a verb in the vocabulary without a descriptor (or vice versa) is a
compile error, backed by a runtime bijection test.

## Alternatives considered

- **Keep `VERB_LABEL_CHANGES` + scatter the rest:** rejected — four verbs ×
  three surfaces is exactly the drift the registry prevents; the worker
  comment already promises "a new verb is one map entry," which only holds if
  the _whole_ descriptor is one entry.
- **Generate the pg_enum from the manifest object:** rejected (correction A) —
  enum values are append-only; deriving them invites reorder/removal hazards.
- **Single `tier` field per verb:** rejected (correction C) — capability is a
  function of (verb, selector); a scalar can't express "free single, pro
  filter."
- **`preview` as a boolean (`requiresPreview`):** rejected (founder push-back
  A) — `keep` needs a lightweight inline confirm, not a modal, and Autopilot
  needs a silent path; three values capture this, a boolean does not.
- **Separate registries for label-modify vs policy vs unsubscribe:** rejected
  — they share copy/shortcut/preview/capability shape; the `execution.kind`
  union is the minimal way to vary only what differs.

## Consequences

### Positive

- One edit-site per verb fact; the worker (P3), web (P4), and bulk verbs (P5)
  all read the same descriptor. Adding a verb is one constant append + one
  descriptor + one explicit pg_enum migration.
- Invariants are testable as data (consensus §5): bijection, D227 shortcuts,
  preview-by-kind, tier monotonicity — caught at P2 with zero consumers.
- Pure builders keep the mutation logic unit-testable and IO-free; the worker
  stays the only place that touches Gmail/DB.

### Negative

- A typed-registry layer to learn before touching any verb. The mapped type +
  discriminated execution union is more machinery than a flat map.
- `LabelChange` is mirrored in `shared/actions` (so shared need not depend on
  workers); P3 reconciles the two to a single source when the worker consumes
  the registry. Until then the structural match is the contract.

### Neutral

- The DB→shared dependency for the verb vocabulary is added only at P5 (when
  the pg_enum imports the constants); P2 ships the constants with no new
  cross-package dependency.

## Implementation notes (rollout)

| Phase             | Registry work                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2 (this ADR)** | `verb-constants` (`keep`, `archive`) + `manifest-entries` + 5 invariant tests. Zero consumers.                                                                                                     |
| **P3**            | `LabelActionWorker` switches on `execution.kind`; `PolicyActionWorker` added; `VERB_LABEL_CHANGES` deleted; per-verb `buildLabelChange`/`buildPolicyWrite` invoked.                                |
| **P4**            | Web surfaces (SelectionBar / ConfirmActionModal / SenderTable / senders-screen) read `copy` + `shortcut` + `preview`; letter-strip; KeyboardCheatsheet.                                            |
| **P5**            | Append `later` / `unsubscribe` / `unarchive` to the vocabulary + descriptors + explicit pg_enum migration; `unsubscribe` / `snooze` execution kinds; `archive` historic-scope param (Codex §10.3). |
| **P6–P9**         | Real single-sender wire, multi-sender bulk + capability gate, sender-filter Pro + two-phase preview snapshot, mailto batch CTA (D230 strict).                                                      |

## References

- Consensus doc: `docs/handoffs/2026-05-30-bulk-actions-final-consensus.md` (§2 design, §5 invariants)
- ADR-0013 (destructive-action pipeline — sibling)
- `packages/shared/src/contracts/verb-constants.ts`, `packages/shared/src/actions/manifest-entries.ts`
- `packages/workers/src/label-action.worker.ts` (`VERB_LABEL_CHANGES`, deleted at P3)
- `packages/db/src/schema/{action-jobs,undo-journal,sender-policies}.ts`
