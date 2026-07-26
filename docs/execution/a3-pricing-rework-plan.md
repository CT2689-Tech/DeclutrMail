# A3 — pricing rework: execution plan

**Decision date:** 2026-07-26 · **Decided by:** founder · **Source:** audit item A3,
`docs/execution/product-launch-audit-2026-07-25.md` §6 "Change (the commercial one)"

**Status:** decided, not yet implemented. This file exists so the decision is
durable and the sequencing survives a session boundary.

---

## The decision

|          | Now                                              | Decided                                                                        |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Free     | 5 cleanup actions **for life**, Triage paywalled | **50 sender decisions/month**, Triage **included**, 1 inbox, 7-day undo        |
| Plus $9  | unlimited actions + Triage                       | **removed entirely**                                                           |
| Pro      | $19/mo · $190/yr · 2 inboxes · 30-day undo       | **$9/mo · $90/yr** · Autopilot + Brief + receipt · **3 inboxes** · 30-day undo |
| Founding | $129/yr, first 250                               | **kept**, reframed as a founding-supporter offer rather than a discount        |

Rationale (audit §6): five lifetime actions cannot produce the "aha" — the aha is
one decision moving 412 emails; Plus monetises a one-time cleanup and withholds
every mechanism that makes month 2 worth paying for; and $190/yr has no market
against Mailstrom (~$59.95/yr) and a free Gmail feature.

**Why this is cheap today and expensive later.** Billing is dark-launched behind
three kill switches (`BILLING_ENABLED`, unset webhook secrets, null catalog ids).
**Nobody has ever been charged.** Changing the ladder now is a config + code
change; changing it after go-live means migrating live subscriptions.

---

## What is genuinely easy

The manifest was built for a re-price — `packages/shared/src/entitlements/manifest.ts`
says so: _"Re-pricing is a one-value change here — nothing else in the codebase
carries a dollar amount or a tier limit."_ That holds for the **prices**.

The Free quota is also easier than it looks. `EntitlementsService.cleanupUnitsUsed`
computes usage as a **live `COUNT` over `action_jobs`** — there is no stored
counter and no reset job. "50/month" is therefore a date predicate
(`created_at >= date_trunc('month', now())`), **not** a migration and **not** a
scheduled reset.

## What is not easy

`'plus'` appears in **65 files** — 36 non-test, 29 test — plus the `workspace_tier`
Postgres enum, which is referenced by both `workspaces.tier` and three columns on
`subscriptions` (`tier`, `scheduled_tier`).

---

## Sequencing

Ordered so each step is independently mergeable and smoke-able.

### 1. Manifest + resolvers (`packages/shared`)

- `FREE_CAPABILITIES` gains `'triage'`.
- `cleanupActionsLifetime` → a monthly quota field; Free = **50**, paid = `null`.
  Rename the field and `cleanupActionsLifetimeFor()` — a "lifetime" name on a
  monthly quota is exactly the class of lie this codebase keeps fixing.
- Pro prices → `usdCents: 900` / `9000`, INR equivalents.
- Delete the `plus` entry and drop `'plus'` from the `TierId` union.

**Set Pro's `paddlePriceId` / `razorpayPlanId` to `null` in the same commit.**
Every price surface clamps on `razorpayPlanId !== null`, so null ids make Pro
unpurchasable until the correct SKU exists. That is the desired fail-safe: it
makes step 5 enforced by the type system rather than remembered.

### 2. Quota window (`apps/api`)

- `cleanupUnitsUsed` gains the calendar-month predicate.
- The `CleanupSummary` contract and every "N of 5 left" copy string follow.
- Check the index: the scan uses `action_jobs_account_status_created_idx`, whose
  trailing column is `created_at`, so the new predicate should be covered — verify
  with `EXPLAIN` rather than assuming.

### 3. Collapse the Plus rung (`apps/api`, `apps/web`)

`EntitlementsService` documents a three-rung action-selector ladder: _"Free
single-sender, Plus explicit bulk, Pro all-matching."_ With Plus gone, decide
explicitly whether Free keeps single-sender only or inherits explicit bulk.
**Recommendation: Free stays single-sender.** Bulk is the paid promise, and a
50/month quota already delivers the payoff moment the audit is asking for.

Also: `inboxLimit` Pro 2 → **3**.

### 4. Database (`packages/db`)

Remove `'plus'` from the `workspace_tier` enum. Per D245 (prelaunch — no
hypothetical compatibility) this is a real removal, not a deprecation. Postgres
cannot drop an enum value in place, so the migration recreates the type and
re-points `workspaces.tier`, `subscriptions.tier`, `subscriptions.scheduled_tier`.

**Pre-check:** the dev DB currently has two `subscriptions` rows at `plus/paused`.
They must be resolved (deleted or repointed) or the migration fails.

### 5. Provider catalog — **founder step**

Pro needs live $9/$90 SKUs in both Paddle and Razorpay.

Plus already has SKUs at exactly $9/$90 (`pri_01ky15axxbeeyge87f9hehw37t`,
`plan_THtwadiHmKTaze`, and the annual pair). **Do not reuse them** — they are
labelled "Plus" at the provider, and that label lands on customer invoices and
receipts permanently.

**Recommended:** re-provision Pro at the new price via the existing
`Provision billing catalog` workflow, then archive the Plus SKUs. Because billing
is dark, those SKUs have **zero subscribers**, so this is clean and free — which
will not be true again after go-live. Write the returned ids back into the
manifest, which un-nulls Pro and makes it purchasable.

### 6. Marketing + pricing page

Three tiers → two. Rewrite the comparison table, remove Plus from
`/pricing`, and reframe Founding Pro as a supporter offer rather than a discount
off a price that no longer exists. Coordinate with audit **B1** (hero rewrite),
which is touching the same surfaces.

---

## Risks

- **Enum migration is the only irreversible step.** Everything else is a code
  change behind a dark billing switch. Take the Supabase backup timestamp before
  applying it in production (daily backups, 7-day retention, PITR deliberately off).
- **Revenue per paid user halves** ($19 → $9). Fixed vendor spend is ~$50–80/mo,
  so roughly 10 subscribers covers infrastructure. This was the founder's explicit
  call with that tradeoff stated.
- **Do not start this mid-session.** 65 files across four packages plus a
  migration is not a tail-end task; a partial pass is how #388's arc ended up
  uncommitted for a day.
