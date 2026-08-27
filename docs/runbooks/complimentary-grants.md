# Complimentary Grants

How to put an email address on Plus or Pro without a payment — advisors,
friends, beta cohorts, anyone you hand an account to before they are a
customer.

**Decision record:** [ADR-0040](../adr/0040-complimentary-tier-is-a-floor.md).
**Mechanism:** `entitlement_grants` + `scripts/grant-tier.ts` (D260).

---

## The one-line model

A grant is a **floor** on `workspaces.tier`, never a written tier:

```
workspaces.tier = max_rank(granting subscriptions, live grant, 'free')
```

So it raises and never replaces. A comped Pro who later buys Plus stays
Pro. A comp that expires drops them to whatever their paid subscription
grants — Pro if they pay for Pro, Plus if they pay for Plus — and to
Free only if they have none.

**Do not hand-write the tier.** `UPDATE workspaces SET tier = 'pro'`
appears to work and then silently un-works: both recompute paths derive
the tier from `subscriptions` alone and fall back to Free, so the first
checkout that person opens — even one they abandon — drops them back with
no event to notice it by. ADR-0040 has the full reasoning.

---

## Where to run it

From the **repo root**. It is a root `package.json` script that opens its
own Postgres connection — no API, no worker, no Redis.

```bash
cd /Users/chintant/projects/DeclutrMail
```

Local dev needs Postgres up on `localhost:5432`. Production needs a DSN
exported (below). Every command runs against **local dev unless you pass
`--prod`**.

---

## Commands

Grant, permanent:

```bash
pnpm grant-tier grant advisor@example.com pro --reason="advisor"
```

Grant, dated (`--expires` means _through_ that day, 23:59:59 UTC):

```bash
pnpm grant-tier grant beta@example.com plus --reason="beta cohort 1" --expires=2026-12-31
```

List every grant, live and lapsed:

```bash
pnpm grant-tier list
```

Revoke before expiry:

```bash
pnpm grant-tier revoke advisor@example.com
```

`--reason` is required — a comp with no stated reason is
indistinguishable, six months on, from a tier someone set by mistake.
`--by=name` overrides the granter (defaults to `$USER`).

Re-granting an email **updates** its row rather than stacking a second
one, and clears any revocation. One grant per identity, matched
case-insensitively (`citext`, same as `users.email`).

---

## Production

Export the session-pooler DSN first — the same value the watchdog scripts
use (Supabase → Project → Connect → Session pooler). Keep it in your
shell; never commit it.

```bash
export SUPABASE_SESSION_DSN='postgresql://…@aws-0-us-west-2.pooler.supabase.com:5432/postgres'
```

Then add `--prod` to any command:

```bash
pnpm grant-tier grant advisor@example.com pro --reason="advisor" --prod
```

`--prod` prints what it is about to do and waits for a typed `y`. Every
command accepts it; `list` is read-only and safe to run any time.

---

## Granting to someone who has not signed up

Fine, and the normal case for an invite. Grants are keyed on EMAIL, so
signup reads the table when it bootstraps their workspace and opens them
at the granted tier immediately. The script says so:

```
✓ future@example.com is comped to pro on PRODUCTION.
  future@example.com has not signed up on PRODUCTION yet — the grant applies when they do.
```

---

## What happens after you grant

- **Takes effect at once.** The script recomputes that workspace itself
  rather than waiting for the 6-hourly reconciliation sweep.
- **They may need to reload.** A comped user with the app already open
  still holds a cached `me` naming the old tier.
- **The Billing screen names it** — "Pro · Complimentary", with the end
  date when the grant has one. No price, no cancel control, because there
  is no subscription to manage.

After a **revoke** below Pro, their active Autopilot rules stay on the
books until the next sweep converges them (≤6h). The script prints a
reminder. That demotion lives in the Autopilot facade on purpose —
billing never writes automation tables (D204).

---

## Verifying a grant landed

```bash
pnpm grant-tier list --prod
```

A `●` marks a live grant, `○` an expired or revoked one. Expired and
revoked rows are kept deliberately: the trail of who was comped, why, and
when it ended is the reason this is a table and not an env var.

To confirm the entitlement itself rather than the grant record, read the
workspace tier:

```bash
psql "$SUPABASE_SESSION_DSN" -c "SELECT u.email, w.tier FROM users u JOIN workspaces w ON w.id = u.workspace_id WHERE u.email = 'advisor@example.com';"
```

---

## Deploy ordering — the one trap

Merging a change to this mechanism fires two workflows at different
speeds:

1. `migration-apply.yml` — on push to main, **no CI gate**, lands within
   about a minute.
2. `deploy-cloud-run.yml` — **waits for green CI**, 10–20 minutes later.

Between the two, the table can exist while the deployed code does not yet
apply the floor. Granting in that window sets the tier, and the
still-running old recompute takes it straight back to Free.

**Wait for the Cloud Run deploy to go green before granting on
production.** This applies only when the mechanism itself changes;
ordinary grants against a deployed system have no such window.

---

## If a comp disappears

Symptom: someone you comped is on Free.

1. `pnpm grant-tier list --prod` — is the row live (`●`), or did it
   expire or get revoked?
2. If it is live, the tier is stale rather than wrong. Re-run the grant;
   it recomputes on the spot.
3. If re-granting does not hold, a recompute path has lost the floor.
   Check that both `BillingWebhookService.recomputeWorkspaceTier` and
   `runBillingReconciliationSweep` still consult `entitlement_grants` —
   they mirror each other and a drift between them IS the bug. The sweep
   spec (`billing-reconciliation.sweep.spec.ts`) covers all six
   compose cases; run it first.
