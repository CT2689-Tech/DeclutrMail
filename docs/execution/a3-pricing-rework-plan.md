# A3 — free-tier activation: execution plan

**Decision date:** 2026-07-26 · **Decided by:** founder · **Source:** audit item A3,
`docs/execution/product-launch-audit-2026-07-25.md` §6

**Status:** decided, not yet implemented.

> **SUPERSEDES the first 2026-07-26 version of this file**, which proposed removing
> the Plus tier and repricing Pro to $9/$90 behind a `workspace_tier` enum migration.
> That version was rejected by the founder in a `/grill-me` session the same day.
> Both of its central bets — "Plus is a churn machine" and "$190/yr has no market" —
> are hypotheses with **zero customers** behind them, and testing them costs an
> irreversible migration. The activation harm A3 actually names is the **Free tier**,
> and that half needs no migration at all. If you are reading the old plan's steps
> (enum migration, 65-file `'plus'` sweep, new Pro SKUs), stop — none of it applies.

---

## The decision

Prices, Founding Pro, and **every provider SKU are untouched.** No enum migration,
no tier removal, no founder provisioning step.

|                | Now                                              | Decided                                                      |
| -------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Free           | 5 cleanup actions **for life**, Triage paywalled | **50 cleanup actions/month**, Triage + bulk + Later included |
| Plus $9 / $90  | unlimited actions + Triage                       | **unchanged price**; now = Free + unlimited volume           |
| Pro $19 / $190 | automation, 2 inboxes, 30-day undo               | **unchanged price**; **3 inboxes**                           |
| Founding Pro   | $129/yr, first 250                               | **unchanged**                                                |

### Final ladder

|                                                   | Free $0                    | Plus $9/$90   | Pro $19/$190 |
| ------------------------------------------------- | -------------------------- | ------------- | ------------ |
| **Cleanup quota**                                 | **50/month** (anniversary) | **Unlimited** | Unlimited    |
| All 5 verbs (K/A/U/L/D), single sender            | ✅                         | ✅            | ✅           |
| Keep / Unarchive — never counted                  | ✅                         | ✅            | ✅           |
| Multi-sender bulk (cap 1000)                      | ✅                         | ✅            | ✅           |
| Triage                                            | ✅                         | ✅            | ✅           |
| Senders · Sender detail · Activity                | ✅                         | ✅            | ✅           |
| Later list · recovery alert · manual wake         | ✅                         | ✅            | ✅           |
| Autopilot · Brief · Screener · Quiet · Follow-ups | ❌                         | ❌            | ✅           |
| Sender-filter (all-matching)                      | ❌                         | ❌            | ✅ _unbuilt_ |
| Inboxes                                           | 1                          | 1             | **3**        |
| Undo window                                       | 7d                         | 7d            | 30d          |

**Plus = Free + unlimited volume.** One row, and it is the row being bought.
Free's quota is the only control.

### Why this shape

- **The activation harm is the Free tier, not Plus.** Five lifetime actions cannot
  produce the "aha" (one decision moving 412 emails), and a lifetime cap gives no
  reason for a second session — so there is no upgrade trigger either.
- **The at-market rung already exists.** Once Triage moves into Free, Plus at $9/mo
  is "unlimited manual cleanup" — exactly Mailstrom's $9/mo anchor. The first paid
  conversion therefore happens at market price, and Pro at $19 is an upsell that can
  be cut later with data, affecting only Pro buyers.
- **Prices are asymmetrically reversible.** Raising later is routine; cutting after
  customers have paid means refunds or grandfathering. Launching at the current
  ladder preserves both directions.
- **Zero provider work** means the catalog-provisioner bug (below) cannot fire.

### Quota semantics — pin these

- **A unit is one SENDER DECIDED**, not one click. A bulk of 50 senders costs 50
  units (`entitlements.service.ts` counting rule; `actions.service.ts` requests
  `actionable.length`). Per-click counting would make the quota meaningless the
  moment bulk exists on Free — 50 clicks × the 1000 cap = 50,000 senders/month.
- **Counted verbs** are exactly `archive | later | delete | unsubscribe`.
  **Keep and Unarchive are free and unlimited** and this must be stated in copy —
  Keep is `policy-only` and writes no `action_jobs` row, so it cannot be counted
  without building a write path purely for metering.
- **Call it "cleanup actions", never "sender decisions".** The API already returns
  `decidedToday` (which includes Keep) next to the quota (which does not); shipping
  the word "decisions" puts a number beside a label it contradicts.
- **The period is the signup anniversary**, anchored on `workspaces.created_at`
  (timestamptz, notNull — **no migration**). Period start is `created_at + N months`
  computed from the original anchor, so Postgres's month clamping self-heals: created
  31 Jan gives 28 Feb then back to 31 Mar, with no drift.
- **Why anniversary and not calendar month:** paid subscriptions renew on their own
  anniversary. A calendar-month Free quota would put a user who upgrades on the 14th
  into two different monthly cycles inside one product, and every "resets" string
  would have to know which one it meant.
- **`resetsAt` is mandatory on the wire.** A per-user anniversary is not derivable in
  the browser, and shipping `remaining` from the server while the client computes the
  deadline gives one sentence two authorities.

---

## The config file (founder ask: tune tiers without a sweep)

**Finding: the config already mostly exists and works.** The "65 files" figure came
from _deleting a tier_ — `'plus'` as a string literal in type unions, switches, and
tests. It was never the cost of moving a feature or changing a price:

- Prices, inbox limits, undo windows, quota, and capabilities are already one object
  in one file (`packages/shared/src/entitlements/manifest.ts`).
- The pricing page **is already generated** — `compare-table.tsx` derives every row
  and cell from `TIER_MANIFEST` via `compareRows()`, and `CAPABILITY_LABELS` is a
  total `Record<Capability, string>`, so an unlabelled capability is a compile error.
- Nav plan-chips derive from `minimumTierForCapability()`. Undo windows resolve
  through `undoWindowDaysFor()` at action time. Autopilot gates on `hasCapability()`.

Four genuine leaks remain. Closing them is what makes tuning a one-file edit.

### Leak 1 — selector tiers are duplicated 15 times in a second file

`packages/shared/src/actions/manifest-entries.ts` carries `{ tier, countsAsCleanup, cap }`
per **verb × selector**. But the values are not per-pair — they are per-axis:

| Fact                 | Reality                                  | Times written    |
| -------------------- | ---------------------------------------- | ---------------- |
| `sender` tier        | `'free'` for all 6 verbs                 | 6                |
| `multi-sender` tier  | `'plus'` for all 5 that support it       | 5                |
| `sender-filter` tier | `'pro'` for all 4 that support it        | 4                |
| `cap`                | `1000`, multi-sender only                | 5                |
| `countsAsCleanup`    | per VERB, identical across its selectors | 15 (for 6 facts) |

That is why "move bulk to Free" currently costs five edits in a file that is not the
pricing config.

**Fix — hoist the axes into the config, leave only what varies per verb:**

```ts
// pricing.config.ts — which tier unlocks each selector
export const SELECTOR_TIERS: Record<SelectorType, ActionTier> = {
  sender: 'free',
  'multi-sender': 'free', // ← the entire A3 bulk change, one line
  'sender-filter': 'pro',
};

// per-selector batch ceiling
export const SELECTOR_CAPS: Partial<Record<SelectorType, number>> = {
  'multi-sender': 1000,
};

// which verbs draw down the quota — one line per verb
export const COUNTS_AS_CLEANUP: Record<ActionVerb, boolean> = {
  keep: false,
  archive: true,
  later: true,
  unsubscribe: true,
  delete: true,
  unarchive: false,
};
```

The registry then declares only the thing that genuinely varies per verb — **which
selectors it supports** (`sender: true, 'multi-sender': true, 'sender-filter': false`).
`ActionCapability` is resolved by a helper, so `EntitlementsService.CLEANUP_VERBS` and
`assertActionSelectorTier` keep working unchanged.

Both new maps are **total records**, so adding a verb or selector without deciding its
tier is a compile error rather than a silent default.

### Leak 2 — copy bakes in config values

Every one of these repeats a number or a plan name that lives in the config, and every
one becomes false when the config changes:

| File                                                                                     | String                                                                                              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `packages/shared/src/contracts/error-codes.ts:125`                                       | "You've used all **5** free sender actions"                                                         |
| `apps/web/src/features/billing/upgrade-modal.tsx:147`                                    | "**five lifetime** cleanup actions, **one sender at a time**" — both halves false after this change |
| `apps/web/src/features/billing/upgrade-modal.tsx:30`                                     | doc comment "5 lifetime cleanup actions"                                                            |
| `apps/web/src/features/billing/billing-screen.tsx:791`                                   | renders the manifest value but hardcodes the word "lifetime"                                        |
| `apps/web/src/app/(marketing)/help/page.tsx:94`                                          | FAQ prose restating the whole ladder                                                                |
| `apps/api/src/common/entitlements/entitlements.service.ts` `CAPABILITY_UPGRADE_MESSAGES` | names plans in strings ("part of the **Plus** plan")                                                |
| `apps/api/src/common/entitlements/entitlements.service.ts` `INBOX_LIMIT_REACHED`         | "Upgrade to **Pro** to connect a second Gmail account"                                              |
| `apps/web/src/lib/entitlements/upgrade-gate.ts:71`                                       | `FREE_CAP_FALLBACK` hardcodes `limit: 5` — see bug 3                                                |

**Fix:** no user-facing string contains a quota number, a limit, or a plan name as a
literal. Plan names come from `TIER_MANIFEST[minimumTierForCapability(cap)].name`;
quota numbers come from the resolver. `CAPABILITY_UPGRADE_MESSAGES` becomes a template
keyed by capability with the plan name interpolated, so moving a capability between
tiers updates its upgrade copy automatically.

`CAPABILITY_UPGRADE_MESSAGES.triage` and `.snoozed` are **deleted** — nothing gates
either capability after this change.

### Leak 3 — tests pin values instead of invariants

`entitlements.test.ts` pins exact capability buckets (test 9), exact inbox limits
(`:79-83`), and the exact promo amount (`:66`). Moving one capability therefore edits
a test as well as the config.

**Fix:** keep exactly **one** deliberately-pinned snapshot as a tripwire, and convert
the rest to invariants that hold under any tuning:

- capability sets cumulative by rank (exists today, test 8)
- **`inboxLimit` and `undoWindowDays` monotonic non-decreasing by rank** — missing
  today; see bug 4
- `ACTION_TIERS` is a prefix of `TIER_IDS` (exists)
- `promo.annual < host.annual < host.monthly × 12` (exists, `:69-70`)
- every `Capability` has a `CAPABILITY_LABELS` entry (compile-time today)
- `SELECTOR_TIERS` and `COUNTS_AS_CLEANUP` are total (compile-time)

### Leak 4 — file name

`manifest.ts` does not announce itself as the pricing knob. Rename to
`packages/shared/src/entitlements/pricing.config.ts` — only **7 files** import it
directly; the other 29 `TIER_MANIFEST` consumers go through the barrel and are
untouched. Per D245 (prelaunch = real removal) this is a rename, not an alias.

**After this: moving a feature between tiers, changing a price, changing the quota,
or moving bulk between tiers is a one-file edit plus one snapshot line.**

---

## Sequencing

### PR A — `feat/d019-free-tier-activation` (atomic)

Ships as one PR so no surface lands in a half-true state. Everything below is one
coherent product change.

1. **`pricing.config.ts`** (renamed from `manifest.ts`) — `FREE_CAPABILITIES` gains
   `'triage'` and `'snoozed'`; `PLUS_CAPABILITIES` becomes identical to Free;
   `cleanupActionsLifetime` → `cleanupActionsPerMonth` (Free 50, all paid `null`);
   `pro.inboxLimit` 2 → 3 and Team/Enterprise follow; add `SELECTOR_TIERS`,
   `SELECTOR_CAPS`, `COUNTS_AS_CLEANUP`. **Prices unchanged.**
2. **`resolve.ts`** — `cleanupActionsLifetimeFor` → `cleanupActionsPerMonthFor`.
3. **`manifest-entries.ts`** — verb entries declare selector _support_ only; tier,
   cap, and cleanup-counting resolve from the config.
4. **`entitlements.service.ts`** — anniversary predicate on `cleanupUnitsUsed`
   (pin UTC explicitly; `date_trunc` otherwise inherits the session timezone);
   `CleanupSummary` gains `resetsAt`; `lockCleanupWorkspace` returns `createdAt`
   (it already selects from `workspaces`); derive all upgrade copy.
5. **`auth.controller.ts`** — `/me` carries the reset instant alongside
   `cleanupRemaining`.
6. **Preview becomes quota-aware** — renders "Uses N of your M remaining this month"
   and swaps confirm for an upgrade CTA when it will not fit, reading the existing
   `useTier().cleanupRemaining`. The server stays the final authority, so a stale
   client that wrongly says "fits" simply gets the existing honest 402.
7. **`snoozed` → Free** — the Later apparatus follows the Later verb. Fixes bug 2.
8. **Serialize the bulk cleanup path** (bug 7) — wrap `enqueueBulk`'s capacity check,
   replay recheck, and inserts in one `db.transaction`, taking
   `lockCleanupWorkspace(mailboxAccountId, tx)` first and passing `tx` throughout,
   exactly as the single-sender path at `actions.service.ts:243-252` already does.
   Hoist the grouped count queries **above** the transaction — they are reads that do
   not need the lock. This is mandatory in the same PR that moves `multi-sender` to
   Free; shipping the retier without it is what makes the race reachable.
9. **Copy** — every string in Leak 2.
10. **Tests** — Leak 3, plus boundary tests for the anniversary maths (created 31 Jan,
    created 29 Feb, and the exact reset instant).

### PR B — `fix/d117-catalog-amount-check` (independent)

Fixes the provisioner bug. No user-visible effect; blocks nothing; must exist before
any future price change.

### Smoke (CLAUDE.md §8 — green CI is not sufficient)

Via the D206 dev test-login on a Free-forced workspace:

- quota at 0 used / mid / exactly at limit / over limit, and the reset date rendered
- a bulk selection that **fits** and one that **does not** — the preview must produce
  both answers, not only the blocking one
- Triage reachable on Free; `/later` reachable on Free; the recovery alert no longer
  402s (check the network tab, not just the absence of a banner)
- `EXPLAIN` the anniversary predicate against
  `action_jobs_account_status_created_idx` rather than assuming coverage
- restore the workspace tier afterwards

---

## Bugs found during the grill (none were in the original plan)

| #   | Where                                                                                     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `apps/api/scripts/provision-billing-catalog.ts:154` (Paddle), `:209` (Razorpay)           | Idempotency matches on **SKU only and never compares the amount**. Change a price, re-run the workflow, and it logs "price `pro_annual` exists", returns the **old** price id, and writes it back to the config. The page then renders the new amount while checkout charges the old one. Fires on the first price change ever made. → PR B                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | `apps/web/src/app/(app)/layout.tsx:230` + `apps/api/src/senders/snoozed.controller.ts:54` | `later` is a **Free** verb, but `/later`, `GET /api/snoozed/recovery` and the manual wake are all **Pro** (`@RequiresCapability('snoozed')` at class level). The alert is enabled on `hasActiveMailbox`, not capability, and its hook "fails quiet" — so every Free/Plus session 402s **silently**. A Free user can move mail out of the inbox on a timer with no way to see it, recover it, or be warned when the return fails. Live in production now. → PR A                                                                                                                                                                                                                                                                                            |
| 3   | `apps/web/src/lib/entitlements/upgrade-gate.ts:71`                                        | `FREE_CAP_FALLBACK` hardcodes `limit: 5, used: 5` — the path taken when the 402 carries no usable details, i.e. a surface inventing a number it was never told. → PR A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | `packages/shared/src/entitlements/entitlements.test.ts:79-83`                             | Capability sets have a cumulative-by-rank invariant; **`inboxLimit` and `undoWindowDays` have none**. Team/Enterprise assert only `toBeGreaterThanOrEqual(2)`, so Pro → 3 yields **Pro 3 > Team 2 > Enterprise 2** with every test green. → PR A                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | `packages/db/src/schema/waitlist.ts:34`                                                   | `waitlist.tier_interest` is a **fourth** `workspace_tier` column. The superseded plan named only three, so its enum migration would have failed at the drop. Moot while Plus stays; matters if a tier is ever removed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7   | `apps/api/src/actions/actions.service.ts:920`                                             | **Bulk cleanup can exceed the monthly quota under concurrent requests.** The bulk path calls `assertCleanupCapacity` with the **default root executor** and no transaction, so `lockCleanupWorkspace`'s `SELECT … FOR UPDATE` is statement-scoped — it commits and releases before the inserts run. The replay check sits outside the lock too. Two concurrent bulks both read `used`, both pass, both insert N rows. **Dormant today** (`assertCleanupCapacityForWorkspace` early-returns on `limit === null`, and `multi-sender` requires `tier: 'plus'`, so only unlimited tiers reach it) — **moving multi-sender to Free makes it live**, with an overrun of N units per racing request. Caught by Codex stop-time review, 2026-07-26. → PR A, step 8 |
| 6   | `packages/db/migrations/`                                                                 | Numbering **gap at 0047**, held by the unmerged `feat/d247-senders-brand-grouping` branch. Its merge inserts 0047 behind 0048–0049 and `atlas.sum` is an ordered hash chain, so that merge needs a sum regeneration. Not A3's, but it fires either way.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## Open, not part of A3

- **A6** — the billing card asserts two plans at once. Last launch blocker that is not
  a founder call.
- **B7** — no partial unique index on live subscriptions per workspace; the dev
  workspace has two `subscriptions` rows (both paused, so nothing double-charges).
  No longer an A3 precondition now that there is no enum migration.
- **Delete availability, action-count divergence, and over-restrictive verb gating** —
  three defects the founder observed by hand on 2026-07-26; under investigation.

## Not verified — do not claim

- Competitor prices are the audit's figures, not a live check.
- No `EXPLAIN` has been run on the anniversary predicate.
- No production read has been done on whether any workspace holds `tier='plus'`.
