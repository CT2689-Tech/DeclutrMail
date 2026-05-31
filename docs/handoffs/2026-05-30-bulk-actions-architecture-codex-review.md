# Bulk Actions Architecture — Codex Review Request

**Author:** Claude (session 2026-05-30) handing off for Codex second opinion
**Reviewer brief:** Self-contained — no prior session context required. References to D-decisions point to `~/.claude/plans/i-want-you-to-smooth-kahn.md`.
**Scope:** PR #135 (`chore/bootstrap-senders-counter`) Step 7b + follow-on PRs. The proposal is structural — affects schema, worker, FE shared modules, and ADR layer.

---

## 1. Context — what's shipped, what's pending

### Shipped today (PR #135, merged commits)

| Slice 1 step | Commit                                                                                                                                                                                                                | What it gives                                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1            | migration `0017_senders_total_received.sql`                                                                                                                                                                           | `senders.total_received bigint NOT NULL DEFAULT 0` + backfill UPDATE + index `(mailbox_account_id, total_received DESC, id DESC)`                      |
| 2            | `initial-sync.worker.ts`                                                                                                                                                                                              | `SenderAggregate.totalReceived` folded during ingest (authoritative count, Path A)                                                                     |
| 3            | DEFERRED                                                                                                                                                                                                              | Pub/Sub incremental ingest worker doesn't exist yet (TODO at `gmail-webhook.service.ts:151`). Reconciliation cron catches drift in interim.            |
| 4            | `senders-counter-reconciliation.worker.ts` + queue + cron driver                                                                                                                                                      | Nightly drift correction CTE, returns `{ corrected, maxAbsDelta, totalSenders, durationMs }`                                                           |
| 4b           | `apps/api/src/worker.ts`                                                                                                                                                                                              | Wired UndoExpiry (5min) + SendersCounterReconciliation (24h) cron drivers (both were unwired since PR #131)                                            |
| 5            | `senders.read-service.ts` + controller                                                                                                                                                                                | `?sort=total\|last_seen\|first_seen\|name` + `?direction=`, per-column ORDER BY + cursor predicate, `meta.query.{totalMatching, globalMaxTotal, asOf}` |
| 6            | `sender-table.tsx` (+ stories + tests)                                                                                                                                                                                | Real `<table>` + sticky `<thead>` + sortable `<th aria-sort>` + 9 columns + 13 stories + 16 tests. Magnitude bar uses page-1 `globalMaxTotal`.         |
| 7a           | `senders-screen.tsx` wires SenderTable behind D49 view toggle. Sort state in Zustand store. Mobile `<sm` forces Grid via `useIsAtMost('sm')`. K/A/U/L → existing `ConfirmActionModal` via `TABLE_VERB_TO_ACTION` map. |

### NOT yet shipped (this proposal's surface area)

| Surface                                    | State                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Real `performAction` API wire              | FAKE today (toast + receipt only, no fetch). Senders screen's K/A/U/L clicks emit toasts that lie. |
| `multi-sender` selector                    | No schema or API path                                                                              |
| Bulk endpoint                              | No POST that accepts ≥2 sender IDs                                                                 |
| `sender-filter` selector                   | No schema or API path                                                                              |
| Select-All-Matching banner                 | No UI                                                                                              |
| `later`, `unsubscribe`, `unarchive` verbs  | `action_verb` pg_enum has only `archive`                                                           |
| Pricing tier gate on bulk                  | No `@RequiresTier` decorator usage                                                                 |
| Free-tier 5-lifetime cleanup counter (D19) | Not implemented                                                                                    |

---

## 2. The problem

DeclutrMail will ship bulk K/A/U/L from multiple screens (Senders today; Triage, Brief, Senders Lab, Autopilot rule-apply soon). Each verb's metadata (label change, microcopy, K/A/U/L shortcut, tier, eligibility predicate, bulk capability, preview requirement) currently lives across ~10 files:

| Location                                                  | What it knows                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `packages/db/schema/action-jobs.ts`                       | `action_verb` pg_enum values                                                           |
| `packages/db/schema/undo-journal.ts`                      | `undo_action_kind` pg_enum values                                                      |
| `packages/workers/label-action.worker.ts`                 | `VERB_LABEL_CHANGES` map                                                               |
| `apps/web/features/senders/data.ts`                       | `canArchive`/`canLater`/`canUnsubscribe` predicates                                    |
| `apps/web/features/senders/selection-bar.tsx`             | hardcoded button list + tone                                                           |
| `apps/web/features/senders/confirm-action-modal.tsx`      | per-verb title/lead/danger flag/historic-toggle logic                                  |
| `apps/web/features/senders/senders-screen.tsx`            | `VERB_PAST`, `TABLE_VERB_TO_ACTION`, `ELIGIBLE` map                                    |
| `apps/web/features/senders/sender-table/sender-table.tsx` | K/A/U/L button + per-row shortcut                                                      |
| (nowhere yet)                                             | tier gating per verb, free-counter rules, bulk-mode per verb, eligibility reason codes |

Adding `mark_read` today = ~10 file edits + drift risk. Six verbs in (D227 K/A/U/L + later + the inevitable `mark_read`/`star`/`trash`) we'll have spent a week on plumbing instead of product.

Bulk wire (Step 7b) is the right moment to fix both — bulk forces us to confront tier gating, eligibility-per-sender, and selector shape uniformly; doing both bulk AND consolidation now avoids retiring per-verb hardcoded buttons later.

---

## 3. Six product decisions (Q-set 1)

These are the founder-acked decisions guiding shape. Each was discussed with options + recommendation; the table below shows the final pick.

| Q                                       | Pick                                                                                                                                                                                                                                                                                         | Reasoning                                                                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1 — Tier gating**                    | Free single-sender + 5-lifetime cleanup counter (D19 literal); Plus multi-sender (cap 1000 ids); Pro adds `sender-filter` selector + 30d undo                                                                                                                                                | D19 says "Free=5 lifetime cleanup actions as taste, Plus=unlimited manual, Pro=Autopilot+30d undo". Filter selector is a clear Pro upgrade hook.                    |
| **Q2 — Long-tail bulk (>25k)**          | Single `action_job` row with 25k-sender soft cap. >25k → banner offers auto-split into N jobs.                                                                                                                                                                                               | Single undo token preserves D35 "Undo last" mental model. 25k senders ≈ 250k Gmail msgs ≈ 25s worker lock — acceptable.                                             |
| **Q3 — Bulk unsubscribe mailto policy** | ConfirmActionModal pre-flight shows split count ("47 instant / 3 need email confirm"). Confirm executes one-click batch + opens N mailto tabs sequentially with 250ms gap (popup-blocker safe). For >5 mailto: degrade to explicit list UI.                                                  | D230: mailto = manual at launch. Honors D230 verbatim.                                                                                                              |
| **Q4 — Preview phasing**                | `multi-sender` (explicit ids) = single-phase POST. `sender-filter` (Pro selector) = two-phase POST `/actions/preview` returning `{ previewToken, resolvedCount, sampleSenders[3], asOf, expiresAt }`. Commit POST includes `previewToken` → server re-validates drift window or rejects 409. | Filter is the only case where server count is the truth. Two-phase only where needed.                                                                               |
| **Q5 — Undo tray grouping (D35)**       | One tray entry per bulk: "Archived 5,234 senders · Undo · View in Activity". Activity page deep-links to per-sender history. NO per-sender entries in tray.                                                                                                                                  | Tray stays light. D35 "Undo last" semantics intact. Audit grain lives on Activity (D58).                                                                            |
| **Q6 — Activity log volume**            | Per-sender `activity_log` rows preserved (Sender Detail D58 needs them). NEW column `activity_log.bulk_action_job_id uuid REFERENCES action_jobs(id)` nullable. Activity page collapses by this FK.                                                                                          | Storage = per-sender; display = grouped. D235 partitioning threshold (2M rows/mailbox) reached only at ~7yrs of extreme-power-user activity — not a launch blocker. |

---

## 4. Four follow-on decisions (Q-set 2)

These are the deeper questions founder asked after Q-set 1 — they constrain the manifest shape.

### Q1 — Truth counts everywhere

**Decision:** Always show `affectedCount` (truth, post-execution), never `requestedCount` (optimistic). When they diverge, surface the diff explicitly ("5,234 selected · 5,219 changed · 15 already archived").

Counts at play:

| Field                       | Source                                     | When known       | Where surfaced                                          |
| --------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------- |
| `previewCount`              | filter resolver (Pro) / FE selection count | preview modal    | preview modal only                                      |
| `requestedCount`            | what FE sent                               | enqueue response | nowhere user-visible (just FE state for reconciliation) |
| `resolvedMessageIds.length` | sender→inbox-msgs join at lock time        | mid-execution    | progress bar only                                       |
| `affectedCount`             | sum of batchModify returns                 | post-execution   | receipt, tray, Activity                                 |
| `noOpCount`                 | ids already in target state                | post-execution   | only shown when non-zero ("X already archived")         |

### Q2 — 509 senders → row counts

**Decision (matches Q5/Q6 above):**

| Surface                                 | Rows for 509-sender bulk                                                   |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `undo_journal`                          | 1 (one token)                                                              |
| `action_jobs`                           | 1 (one click)                                                              |
| `activity_log`                          | 509 (per-sender, for Sender Detail audit)                                  |
| Undo tray UI                            | 1 ("Archived 509 senders · Undo · View in Activity")                       |
| Activity page (default view)            | 1 card (grouped by `bulk_action_job_id`)                                   |
| Activity page (expanded bulk)           | 509 rows on click                                                          |
| Sender Detail page (per-sender history) | 1 row in that sender's history ("Archived · 2026-05-30 · via bulk action") |

Storage = per-sender. Display = grouped. Per-sender preserved because Sender Detail (D58) needs it.

### Q3 — Single-sender undo within bulk

**Decision: forward "restore from bulk" via NEW action, not partial undo.**

Reasoning: D232 undo_journal is atomic-per-action_job. Partial undo would add `partial_reversion_ids text[]` column + two undo states + filter logic. Instead model "restore this one sender from bulk" as a NEW forward action with verb=`unarchive` (or generalized `restore`). Original bulk's undo token unchanged — Gmail re-adding INBOX to a msg already-in-INBOX is a no-op, so atomic undo of full bulk after restore is idempotent. Schema clean, UX clear: "Undo" undoes what you just did; "Restore" takes a new action.

Sender Detail page gets "Restore from bulk" button when most recent action was a bulk-archive within undo window.

### Q4 — Scalable to delete / move / label / etc.

**Decision: formalize Label-Modify Action Pipeline via ADR-0015.**

In scope (single verb-agnostic pipeline):

- `archive`, `later`, `unsubscribe`, `unarchive` (PR #135 Slice 1 bulk)
- `mark_read`, `star`, `trash`, `apply_label`, `move_to_folder` (future, single map entry each)

Explicitly out of scope (separate pipelines):

- `send` / `forward` / `reply` (V2.1, needs `gmail.send` scope, D84)
- `permanent_delete` (no undo possible; D232 contract broken)
- `download_attachment` (read-only; D7 attachment-storage prohibition)
- `snooze` (D78–D83, time-dimension, existing SnoozeWorker per D203 cronPolicy)
- `apply_autopilot_rule` (rule-driven upstream, same downstream pipeline)

Per-new-verb cost target: **1 manifest entry + 2 enum migrations.**

---

## 5. Proposed architecture — Action Manifest

### 5.1 New package surface

```
packages/shared/src/actions/
  action-manifest.ts        # ActionDescriptor type + invariants
  manifest-entries.ts       # ACTION_MANIFEST: Record<ActionVerb, ActionDescriptor>
  eligibility.ts            # EligibilityResult union + helpers
  derivations.ts            # filterByTier(), filterBySurface(), shortcutMap()
  index.ts                  # public exports
```

Both BE (`apps/api`, `packages/workers`) and FE (`apps/web`) consume the same manifest module. Tier guard, label-change map, microcopy, button rendering, shortcut listener, Storybook story matrices ALL derive.

### 5.2 ActionDescriptor type

```typescript
export interface ActionDescriptor {
  /** Matches action_verb pg_enum AND undo_action_kind pg_enum. */
  readonly verb: ActionVerb;

  /** D227 canonical letter. null = no shortcut. */
  readonly shortcut: 'K' | 'A' | 'U' | 'L' | null;

  /** All user-facing strings. NO other file builds verb copy. */
  readonly copy: {
    primary: string; // button: "Archive"
    past: string; // receipt: "Archived"
    title: (n: number) => string; // modal title
    lead: (n: number) => string; // modal lead
  };

  /** Where this verb renders. Filters button arrays per surface. */
  readonly surfaces: ReadonlyArray<
    | 'triage'
    | 'senders-table'
    | 'senders-grid'
    | 'sender-detail'
    | 'brief'
    | 'screener'
    | 'activity'
  >;

  /** Pricing gate (D19). FE shows upgrade modal; BE @RequiresTier guard. */
  readonly tier: 'free' | 'plus' | 'pro';

  /** Counts against Free 5-lifetime-cleanup counter (D19). */
  readonly countsAsCleanup: boolean;

  /** Triggers ConfirmActionModal (D226) — destructive verbs only. */
  readonly requiresPreview: boolean;

  /**
   * Bulk capability:
   *   single          = one sender / click
   *   bulk-cap        = multi-sender selector, cap 1000 ids (Plus+)
   *   bulk-unlimited  = sender-filter selector, server-snapshot (Pro)
   */
  readonly bulkMode: 'single' | 'bulk-cap' | 'bulk-unlimited';

  /**
   * Worker pipeline.
   *   label-modify  = LabelActionWorker (this PR's surface)
   *   policy-only   = senderPolicies write, no Gmail call (Keep, Protect)
   *   snooze        = SnoozeWorker (D203 cronPolicy)
   *   send          = SendWorker (V2.1, gmail.send scope)
   */
  readonly pipeline: 'label-modify' | 'policy-only' | 'snooze' | 'send';

  /** Label transform for label-modify pipeline. Null otherwise. */
  readonly labelChange: {
    forward: LabelChange;
    reverse: LabelChange;
    /** Applied only when verbParams flag is set (e.g., archiveHistoric). */
    conditional?: Record<string, { forward: LabelChange; reverse: LabelChange }>;
  } | null;

  /** Visual tone — drives button color + modal eyebrow. */
  readonly tone: 'neutral' | 'forward' | 'destructive';

  /** Per-row eligibility — replaces canArchive/canLater/canUnsubscribe. */
  readonly eligibility: (sender: SenderShape, ctx: EligibilityContext) => EligibilityResult;

  /** Extra params (e.g., apply_label needs labelId). Validates at API boundary. */
  readonly verbParamsSchema: ZodSchema | null;

  /** Modal offers "also clear backlog" toggle. */
  readonly supportsHistoricToggle: boolean;
}

export type EligibilityResult =
  | { eligible: true }
  | {
      eligible: false;
      reason:
        | 'protected'
        | 'no-unsub-header'
        | 'tier-locked'
        | 'already-applied'
        | 'free-counter-exhausted';
      upgradeable: boolean;
    };
```

### 5.3 Manifest sketch (4 verbs for PR #135 + 4 follow-on entries)

`archive`, `later`, `unsubscribe`, `keep` are needed for current screens. `unarchive` is needed for Q3 (restore-from-bulk). `mark_read`, `star`, `trash` shown as preview of what new verbs cost. Full sketch in the conversation; key entries:

```typescript
archive: {
  verb: 'archive',
  shortcut: 'A',
  copy: {
    primary: 'Archive',
    past: 'Archived',
    title: (n) => `Archive all mail from ${n} sender${n === 1 ? '' : 's'}`,
    lead: () => `Every message moves out of inbox into Gmail's archive. Nothing is deleted.`,
  },
  surfaces: ['triage', 'senders-table', 'senders-grid', 'sender-detail', 'brief'],
  tier: 'free',
  countsAsCleanup: true,
  requiresPreview: true,
  bulkMode: 'bulk-unlimited',
  pipeline: 'label-modify',
  labelChange: {
    forward: { removeLabelIds: ['INBOX'] },
    reverse: { addLabelIds: ['INBOX'] },
  },
  tone: 'forward',
  eligibility: (s) =>
    s.isProtected
      ? { eligible: false, reason: 'protected', upgradeable: false }
      : { eligible: true },
  verbParamsSchema: null,
  supportsHistoricToggle: false,
},

later: {
  verb: 'later',
  shortcut: 'L',
  // ...
  labelChange: {
    forward: { addLabelIds: ['DeclutrMail/Later'], removeLabelIds: ['INBOX'] },
    reverse: { removeLabelIds: ['DeclutrMail/Later'], addLabelIds: ['INBOX'] },
    conditional: {
      archiveHistoric: {
        forward: { removeLabelIds: ['INBOX'] },
        reverse: { addLabelIds: ['INBOX'] },
      },
    },
  },
  verbParamsSchema: z.object({ archiveHistoric: z.boolean() }),
  supportsHistoricToggle: true,
},

unarchive: {                   // Q3 — restore from bulk
  verb: 'unarchive',
  shortcut: null,              // not a primary surface verb
  surfaces: ['sender-detail', 'activity'],
  tier: 'free',
  countsAsCleanup: false,
  requiresPreview: false,
  bulkMode: 'single',          // restore one-at-a-time only
  pipeline: 'label-modify',
  labelChange: {
    forward: { addLabelIds: ['INBOX'] },
    reverse: { removeLabelIds: ['INBOX'] },
  },
  tone: 'neutral',
  eligibility: (s) =>
    s.lastAction?.verb === 'archive' && s.lastAction.withinUndoWindow
      ? { eligible: true }
      : { eligible: false, reason: 'already-applied', upgradeable: false },
  verbParamsSchema: null,
  supportsHistoricToggle: false,
},
```

### 5.4 What derives from the manifest

**Backend:**

```typescript
// Worker — was VERB_LABEL_CHANGES, now one line
const change = ACTION_MANIFEST[job.verb].labelChange;

// API guard
@RequiresTier(ACTION_MANIFEST[verb].tier)

// Counter increment
if (ACTION_MANIFEST[verb].countsAsCleanup) await incrementCounter(...);

// Selector cap
const cap = ACTION_MANIFEST[verb].bulkMode === 'bulk-cap' ? 1000 : Infinity;

// Test invariant
test('every action_verb enum value has manifest entry', () => {
  for (const v of actionVerb.enumValues) expect(ACTION_MANIFEST[v]).toBeDefined();
});
```

**Frontend:**

```typescript
// SelectionBar buttons — derives
const visibleVerbs = Object.values(ACTION_MANIFEST)
  .filter(d => d.surfaces.includes(currentSurface))
  .filter(d => d.tier === 'free' || tierGte(userTier, d.tier));

// ConfirmActionModal — title/lead/historic toggle all from manifest
const d = ACTION_MANIFEST[verb];
<h2>{d.copy.title(senders.length)}</h2>
{d.supportsHistoricToggle && <ArchiveHistoricToggle />}

// K/A/U/L shortcut listener — generic
const onKey = (e) => {
  const d = Object.values(ACTION_MANIFEST).find(x => x.shortcut === e.key.toUpperCase());
  if (d) requestAction(d.verb);
};

// Storybook — auto-generates one story per verb
export const AllVerbs = () =>
  Object.values(ACTION_MANIFEST).map(d => <ActionPreview key={d.verb} verb={d.verb} />);
```

### 5.5 Type-level cross-check

```typescript
// packages/shared/src/actions/types.ts
export type ActionVerb = keyof typeof ACTION_MANIFEST;
export const ACTION_VERB_VALUES = Object.keys(ACTION_MANIFEST) as ActionVerb[];

// packages/db/schema/action-jobs.ts
import { ACTION_VERB_VALUES } from '@declutrmail/shared/actions';
export const actionVerb = pgEnum('action_verb', ACTION_VERB_VALUES);

// Compile-time invariant
type _Assert = ActionVerb extends (typeof actionVerb.enumValues)[number] ? true : never;
```

### 5.6 What stays OUT of the manifest (explicit boundary)

| Concern                                                           | Lives where                 | Why                                                                 |
| ----------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------- |
| Per-sender selection state                                        | `features/senders/store.ts` | client state, not verb metadata                                     |
| Selector shape (sender / messages / multi-sender / sender-filter) | `actions.types.ts`          | orthogonal — every verb supports every selector its bulkMode allows |
| Idempotency key generation                                        | `useEnqueueAction` hook     | per-click concern                                                   |
| Undo tray rendering                                               | `features/undo-tray/`       | aggregates across verbs, doesn't dispatch on verb                   |
| Gmail batchModify chunking                                        | worker internals            | execution detail                                                    |
| Activity log shape                                                | `activity_log` schema       | audit concern with own retention rules (D58)                        |

---

## 6. Schema deltas required

| Table                                | Delta                                                                                                                                | PR   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| `action_verb` pg_enum                | ADD VALUE: `later`, `unsubscribe`, `unarchive`, (`keep` if we want policy-only verbs in same table; debatable — see open Q #3)       | #139 |
| `undo_action_kind` pg_enum           | ADD VALUE: `unarchive` (and any future `restore` semantics)                                                                          | #139 |
| `action_jobs`                        | ADD COLUMN `verb_params jsonb NOT NULL DEFAULT '{}'::jsonb` — for verbs that need params (`archiveHistoric`, future `labelId`, etc.) | #139 |
| `action_jobs.selector` jsonb $type   | Extend union: `sender \| messages \| multi-sender \| sender-filter`                                                                  | #139 |
| `activity_log`                       | ADD COLUMN `bulk_action_job_id uuid REFERENCES action_jobs(id) ON DELETE SET NULL` (nullable) + index                                | #139 |
| `undo_journal.payload.message_ids[]` | No schema change. Worker already stores arrays.                                                                                      | —    |

All deltas are additive. Atlas linting (`data_depend = error`, `concurrent_index = error`) should pass. Backfill: trivial (new columns default to safe values).

---

## 7. Worker changes

`LabelActionWorker` (`packages/workers/src/label-action.worker.ts`) — minimal changes:

```typescript
// BEFORE
export const VERB_LABEL_CHANGES = {
  archive: {
    forward: { removeLabelIds: ['INBOX'] },
    reverse: { addLabelIds: ['INBOX'] },
  },
} as const;

// AFTER
import { ACTION_MANIFEST } from '@declutrmail/shared/actions';
// VERB_LABEL_CHANGES deleted entirely

// In execute():
const descriptor = ACTION_MANIFEST[job.verb];
if (!descriptor || descriptor.pipeline !== 'label-modify') {
  throw new ValidationError(`verb ${job.verb} not in label-modify pipeline`);
}
const change = descriptor.labelChange!.forward;
// + conditional appends if job.verbParams has matching key
for (const [paramKey, paramChange] of Object.entries(descriptor.labelChange?.conditional ?? {})) {
  if (job.verbParams[paramKey] === true) {
    change.addLabelIds = [
      ...(change.addLabelIds ?? []),
      ...(paramChange.forward.addLabelIds ?? []),
    ];
    change.removeLabelIds = [
      ...(change.removeLabelIds ?? []),
      ...(paramChange.forward.removeLabelIds ?? []),
    ];
  }
}
```

Per-mailbox advisory lock, idempotent batchModify, durable `resolvedMessageIds` — all unchanged.

`policy-only` pipeline (Keep, Protect) does NOT enter `LabelActionWorker`. Routed to a sibling `PolicyActionWorker` (or inlined in `ActionsService` for simplicity, since policy-only writes are sync). Open Q #3 below.

---

## 8. FE changes

### 8.1 New shared feature module

```
apps/web/src/features/actions/
  api/
    use-enqueue-action.ts      # TanStack mutation + idempotency-key gen
    use-action-status.ts       # poll GET /api/actions/:id
    idempotency.ts             # uuid v4 per click
  preview/
    action-preview-modal.tsx   # generic, reads manifest (replaces senders/confirm-action-modal.tsx)
    bulk-mailto-split.tsx      # Q3 pre-flight UI for unsubscribe
  receipt/
    action-receipt-toast.tsx   # generic, reads manifest (replaces senders/receipt logic)
  shortcuts/
    use-action-shortcuts.ts    # K/A/U/L listener, dispatches from manifest
  selection-bar/
    bulk-selection-bar.tsx     # generic, reads manifest (replaces senders/selection-bar.tsx)
```

D220 promotion candidate once 3+ consumers (Senders + Triage + Brief). Land in `apps/web/features/actions/` first; promote to `packages/shared/actions/` when 3rd consumer arrives.

### 8.2 Senders screen wire (replaces fake `performAction`)

```typescript
// senders-screen.tsx — after manifest landing
const enqueue = useEnqueueAction();

const performAction = useCallback(
  async (verb: ActionVerb, senders: Sender[], verbParams?: Record<string, unknown>) => {
    const idempotencyKey = newIdempotencyKey();
    const selector: ActionSelector =
      senders.length === 1
        ? { type: 'sender', senderId: senders[0].id }
        : { type: 'multi-sender', senderIds: senders.map((s) => s.id) };

    const { actionId } = await enqueue.mutateAsync({
      verb,
      selector,
      verbParams: verbParams ?? {},
      idempotencyKey,
    });

    // useActionStatus polls; receipt updates with affectedCount on done
    setReceipt({ actionId, verb, requestedCount: senders.length });
    setSelected(new Set());
  },
  [enqueue],
);
```

### 8.3 ConfirmActionModal becomes generic

```typescript
// generic — works for any manifest verb
export function ActionPreviewModal({ verb, senders, ... }) {
  const d = ACTION_MANIFEST[verb];
  if (!d.requiresPreview) return null;
  return (
    <Modal>
      <Eyebrow tone={d.tone}>{d.copy.title(senders.length)}</Eyebrow>
      <p>{d.copy.lead(senders.length)}</p>
      {d.supportsHistoricToggle && <HistoricToggle />}
      {verb === 'unsubscribe' && <BulkMailtoSplit senders={senders} />}
      <Footer>…</Footer>
    </Modal>
  );
}
```

---

## 9. PR sequencing

| PR                                  | Branch                             | Scope                                                                                                                                           | Net LOC          |
| ----------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| **#135** (active)                   | `chore/bootstrap-senders-counter`  | Slice 1 Steps 1–7a (DONE). Merge with bulk hardcoded OR add manifest as final commit.                                                           | +220/-64 (today) |
| **#136**                            | `chore/action-manifest-foundation` | ADR-0015 + manifest module + types + invariant tests. Zero consumers yet.                                                                       | ~+250            |
| **#137**                            | `refactor/worker-reads-manifest`   | LabelActionWorker reads from manifest; delete `VERB_LABEL_CHANGES`.                                                                             | -30 net          |
| **#138**                            | `refactor/web-reads-manifest`      | SelectionBar, ConfirmActionModal, SenderTable, senders-screen consume manifest; delete `canX`, `VERB_PAST`, `TABLE_VERB_TO_ACTION`, `ELIGIBLE`. | -100 net         |
| **#139**                            | `feat/d226-bulk-verbs-schema`      | Add `later`, `unsubscribe`, `unarchive` verbs (manifest entries + pg_enum + worker label-change). Schema deltas in §6.                          | ~+200            |
| **#140**                            | `feat/d226-multi-sender-selector`  | `multi-sender` selector + cap 1000 + `@RequiresTier('plus')` decorator + Free 5-lifetime-counter.                                               | ~+250            |
| **#141**                            | `feat/d226-fe-actions-feature`     | `features/actions/` shared module + senders-screen wires REAL API (replaces fake `performAction`).                                              | ~+350            |
| **#142** (split-out if scope blows) | `feat/d226-sender-filter-selector` | `sender-filter` selector + two-phase preview endpoint + Select-All-Matching banner + Pro tier gate.                                             | ~+400            |

### Sequencing decision

**Option A: Manifest in PR #135 as one final commit.** Slice 1 components consume manifest from day 1. Refactor cost paid before any new consumer ships verb-hardcoded.

**Option B: Manifest as PR #136 immediately after #135 merges.** Slice 1 ships verb-hardcoded; #136 refactors within 24h. Window of duplication minimal.

**Option C: Defer manifest until 6th verb forces it.** Pay 10-site edit cost once.

Recommend **A** because Slice 1 components are unmerged and the refactor is small now; cost grows with every component shipped verb-hardcoded.

---

## 10. Risks + opinions Codex specifically asked to weigh in on

### 10.1 Is the Action Manifest overengineered for 4 verbs?

At 4 verbs (archive + later + unsubscribe + keep), the manifest is ~200 LOC replacing ~150 LOC of scattered maps. Net cost ~+50 LOC. At 8 verbs (add mark_read + star + trash + apply_label), net cost would be ~-200 LOC (manifest absorbs 4 more entries at ~20 LOC each; scattered approach would add ~80 LOC per verb × 4 = 320 LOC).

**Codex Q1:** Is this pattern justified at 4 verbs? Or should we wait until verb #6 before introducing it?

### 10.2 Should `keep` / `protect` be in the same manifest as label-modify verbs?

`keep` and `protect` have no Gmail effect — they only write `senderPolicies` rows. They share UI surface (K button alongside A/U/L) and benefit from manifest microcopy + shortcut centralization. But their `pipeline: 'policy-only'` value means the LabelActionWorker rejects them, and they need a separate sync write path in `ActionsService`.

Two options:

- **A. Same manifest, `pipeline` field discriminates.** One source of truth for shortcuts + microcopy. Worker routing branches on `pipeline`.
- **B. Separate manifest for policy-only verbs.** Cleaner separation. Two files to keep aligned for FE button rendering.

**Codex Q2:** Pick A or B?

### 10.3 `verbParams` carrying `archiveHistoric` — abstraction leak?

`archiveHistoric` is a generic concept (also applies to `later` per current modal). Modeling it as `verbParams.archiveHistoric` flag + manifest's `conditional.archiveHistoric` label change adds a level of dynamism (worker reads param key, looks up conditional label change). Alternative: model "Unsubscribe + archive backlog" as TWO atomic action_jobs (unsubscribe + archive) chained. Cleaner verb isolation but two undo tokens for one user click = breaks D35 mental model.

**Codex Q3:** Is the conditional label change pattern sound, or should we decompose into two atomic action_jobs?

### 10.4 Two-phase preview — risk of stale `asOf` window

`sender-filter` selector POST is two-phase: preview returns `{ previewToken, asOf, expiresAt }`. Commit POST includes `previewToken` and rejects 409 if `asOf` is older than N seconds.

What N? Pub/Sub ingest drift (D8 worker, not yet built) could update sender list every few seconds. If N=30s, large bulks could fail at commit when the user took 35s to read the modal. If N=5min, "5,234 selected" could be 5,234 + 50 new senders by commit time.

**Codex Q4:** What's a defensible N? Or should preview snapshot the resolved id list itself (server-side, cached by previewToken) so drift is impossible? Tradeoff: cached id list at scale = ~80KB / 5k senders × 10 active previews = ~800KB Redis memory. Acceptable.

### 10.5 Free 5-lifetime-cleanup counter — atomic increment vs eventual

D19: Free user has 5 lifetime cleanup actions; 6th click blocked. Currently no `workspaces.lifetime_cleanup_actions_used` column. Decision needed:

- **Increment at API enqueue (sync).** Free user clicks 6th time → POST rejected 402 Payment Required before worker runs. Race-safe via row-level UPDATE WHERE current < 5.
- **Increment at worker done (eventual).** User can spam-click 100 times if BE accepts faster than worker drains; cleanup counter goes negative-ish (correct after worker drains). Confusing UX.

Recommend sync at enqueue. Refunds on `action_jobs.status='failed'` via reverse decrement.

**Codex Q5:** Sync increment OK or hidden race? Should be tested against testcontainers + concurrent POSTs.

### 10.6 K/A/U/L shortcut binding from manifest — keyboard layout risk

`K`/`A`/`U`/`L` are baked in as values. International keyboards (Dvorak, AZERTY, ZHCN-pinyin) get scrambled. D227 explicitly says K/A/U/L. Manifest reads `e.key.toUpperCase()` which honors layout — but means a Dvorak user's "K" is at a different physical key. Acceptable per D227's English-first launch? Or should manifest also carry `code: 'KeyK'` for physical-key binding as opt-in?

**Codex Q6:** Layout-sensitive (current) vs layout-invariant (`code`) — which honors D227 better?

### 10.7 The "fake performAction" today — should we ship the bulk wire as the FIRST real wire?

Currently senders-screen's `performAction` is a fake (toast + receipt, no fetch). Bulk wiring (PR #141) replaces the fake with a real API call. We could ALSO ship a single-sender real wire in an earlier PR (#140 already has the API surface ready since single-sender uses today's `archiveSelector.type='sender'`).

Two paths:

- **A. Ship single-sender real wire in #140; bulk in #141.** Tighter PRs, faster smoke-testable end-to-end for single first.
- **B. Ship single + bulk together in #141.** One real-wire PR, but larger.

**Codex Q7:** Path A or B?

### 10.8 Worker advisory-lock duration concern at scale

25k-sender bulk = ~25s mailbox advisory lock. Any concurrent action on that mailbox queues behind it. User who triggers a 25k bulk then immediately archives a single sender from Triage waits 25s for the second action. Acceptable, or should the worker yield the lock between chunks (allowing interleaving)?

Yielding adds complexity: undo grouping per chunk, partial-success semantics. The all-or-none invariant (Q-set 1 / Q2 above) breaks.

**Codex Q8:** Hold lock 25s, or build interleaving now?

---

## 11. Open product questions still on founder's plate

These are NOT for Codex — they're flagged for the founder to resolve before PR #139+ proceed:

1. Free-tier counter — does ONE bulk POST = N actions (counts every affected sender) OR = 1 action (counts as one click)? D19 ambiguous. Recommend N (per affected sender) to keep funnel honest.
2. Pro 30-day undo — is this UI-only (extended expiry on undo_journal) or also extends activity_log retention? Plan implies UI-only.
3. Should `keep` ever surface in bulk UI? Today's selection bar omits it (Keep doesn't make sense to bulk-apply ambiguously). Manifest's `surfaces` field controls this — pick once, document.
4. Receipt copy when affectedCount diverges from requestedCount — is "5,234 selected · 15 already archived" a single toast line or two-stage ("Archived 5,219" + secondary "15 were already archived")?
5. Activity log per-sender writes for 5k-bulk = 5k INSERTs in one tx — should we batch-insert (one statement) or stream (one per sender)? Worker performance question.

---

## 12. Codex review request (specific)

Please weigh in on:

1. **Manifest pattern justified at 4 verbs?** (§10.1)
2. **Same manifest for policy-only verbs (keep/protect) or separate?** (§10.2)
3. **`verbParams.archiveHistoric` conditional label change — sound or should decompose?** (§10.3)
4. **Two-phase preview drift window N — value + caching strategy?** (§10.4)
5. **Free counter increment timing — sync vs eventual?** (§10.5)
6. **K/A/U/L shortcut binding — `key` vs `code`?** (§10.6)
7. **Real-wire sequencing — single-then-bulk or both at once?** (§10.7)
8. **Worker lock duration vs interleaving?** (§10.8)

And anything else that smells off in §3–§9. Pricing/D-decision reads welcome — D19, D35, D58, D227, D230, D232 are the ones I leaned on most.

---

## 13. References

- Plan: `~/.claude/plans/i-want-you-to-smooth-kahn.md`
- CLAUDE.md: `/Users/chintant/projects/DeclutrMail/CLAUDE.md`
- ADR-0014 (counter): `docs/adr/0014-senders-total-received-counter.md`
- Senders list contract: `docs/api/senders-list-contract.md`
- Existing schema:
  - `packages/db/src/schema/action-jobs.ts`
  - `packages/db/src/schema/undo-journal.ts`
  - `packages/db/src/schema/activity-log.ts`
  - `packages/db/src/schema/senders.ts`
- Existing worker: `packages/workers/src/label-action.worker.ts`
- Existing API: `apps/api/src/actions/actions.{controller,service,types}.ts`
- Existing FE: `apps/web/src/features/senders/{senders-screen,selection-bar,confirm-action-modal,sender-table/sender-table}.tsx`
- PR #135: `chore/bootstrap-senders-counter` (8 commits, awaiting bulk wire)

---

## 14. TL;DR for Codex

We're about to wire bulk K/A/U/L for the Senders screen. Doing it means touching 10 scattered files for every verb. Founder wants the wiring to scale to mark_read/star/trash/move-to-folder without paying that cost N more times.

Proposal: **one Action Manifest** (typed descriptor record in `packages/shared/actions/`) — labelChange, microcopy, tier gate, eligibility predicate, shortcut, bulk-mode, preview requirement all live in one entry per verb. Worker + FE buttons + Storybook + tests all derive.

Six product decisions (tier gating, long-tail bulk cap, mailto unsub policy, preview phasing, undo tray grouping, activity log volume) are made. Four follow-on decisions (truth counts, per-sender activity log rows, single-sender undo as forward "restore" action, label-modify-pipeline ADR) are made.

Want your second opinion on: §10.1–§10.8 (eight specific architectural calls) before we commit to the manifest landing in PR #135 vs a fresh PR #136.
