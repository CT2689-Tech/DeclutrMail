# ADR-0040: A complimentary tier is a floor, never a written tier

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** founder, Claude
- **Related D-decisions:** D17–D21, D19, D117, D251, 0051

## Context

The founder needs to put specific email addresses on Pro or Plus without
a payment — advisors, friends, beta cohorts, the people you hand an
account to before you have customers.

`workspaces.tier` is the single column every gate reads: the
`CapabilityGuard`, the Action Registry's `satisfiesActionTier`, the
Autopilot demotion sweep, the triage session stats. So the obvious move
is to write it:

```sql
UPDATE workspaces SET tier = 'pro' WHERE id = '…';
```

That works, and then it stops working, with no event to notice it by.

Two paths recompute `workspaces.tier`, and both derive it from the
`subscriptions` table alone, falling back to `'free'`:

- `BillingWebhookService.recomputeWorkspaceTier` — runs on any billing
  event for that workspace
- `runBillingReconciliationSweep` — every 6 hours, plus worker boot

Today the sweep's `WHERE EXISTS` spares a workspace that has no
subscription rows at all, which is exactly why a hand-written tier
_appears_ durable. The moment the comped person opens a checkout — even
one they abandon — a row exists, the next recompute sees no granting
subscription, and they silently drop to Free. Verified against the dev
DB: same state, `main`'s recompute SQL returns `free`, the floored one
returns `pro`.

This is the same shape as the capability-guard defect in CLAUDE.md §2.6:
one side of a pair is taught a rule and the other is not, the two agree
in every test, and they drift in production with nothing to notice.

## Decision

Complimentary tier lives in `entitlement_grants` (email, tier, reason,
granted_by, expires_at, revoked_at) and is applied as a **floor**:

```
workspaces.tier = max_rank(granting subscriptions, live grant, 'free')
```

Three rules follow, and all three are load-bearing.

**1. A grant raises; it never replaces.** Comped Pro who later buys Plus
stays Pro. A comp that expires drops them to the Plus they pay for, not
to Free. An overwrite-style grant gets the second case wrong, and gets it
wrong in the direction that takes away something the customer is paying
for.

**2. Every recompute path applies the floor.** There are three, and all
three consult the table: the webhook recompute (TS), the sweep (SQL), and
signup's `insertWorkspaceAndUser`. Signup is included because grants are
keyed on EMAIL — a grant can be written before that person exists, and a
comped invitee who lands on Free for their whole first session, becoming
Pro up to six hours later, is a broken first run.

**3. The tier stays written to `workspaces.tier`.** A resolver-only
grant was rejected. Several readers query `workspaces.tier` in raw SQL
without going through `EntitlementsService` — `AutopilotReadService`'s
`demoteUnattendedRulesForUnentitledTiers` is a cron with no request and
no principal. A comp that existed only in the request-time resolver
would be invisible to it, and it would strip a comped Pro's Autopilot
rules on its next pass. Writing through means every existing reader
keeps working unchanged.

The sweep's `WHERE` gains an arm selecting **every workspace holding any
grant row, live or not**. That is what ages a comp out: an expired or
revoked grant contributes nothing to the max, so the workspace recomputes
down. No recency bound — 0051 shipped one of those once and had to remove
it, and a comp that lapsed months ago must still drop. It doubles as the
backstop that applies a new grant within one sweep even if nothing wrote
it through.

The admin surface is `pnpm grant-tier` (list / grant / revoke), guarded
by an explicit `--prod` flag and a typed confirmation. No admin API
route: a privileged write path that grants paid entitlement needs its own
security review, and at this volume a script does not.

The ordering (`tierRankSql`) and the liveness predicate
(`liveGrantTiersSql`) are derived from `TIER_RANK` and defined once in
`apps/api/src/common/entitlements/entitlement-grants.ts`. A hand-written
`CASE` in either recompute would sort a newly added tier below Free and
silently stop granting.

## Consequences

- Anyone touching a tier recompute must preserve the floor. The two
  paths already carry "change one, change both" cross-references; the
  grant arm is now part of what that covers.
- `founding_member` is deliberately NOT floored. That flag is a property
  of what someone bought (D126 price lock) — a comp must not mint one.
- The Billing screen names the comp ("Pro · Complimentary", plus the
  grant's end date when it has one). It renders only when the resolved
  tier has actually caught up to the grant; during the sweep-only drift
  window the card would otherwise read "Free" above "Pro is
  complimentary on this account".
- Revoking a comp below `autopilot-active` leaves active Autopilot rules
  standing until the next sweep converges them (≤6h). The script says so.
  Demotion stays in the Autopilot facade — billing never writes
  automation tables (D204).
- Grant rows are kept after expiry or revocation. The trail of who was
  comped, why, and when it ended is the reason this is a table and not
  an env var.
