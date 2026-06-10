# ADR-0023: Upstash Fixed plan + three-layer billing guardrails on all metered vendors

- **Status:** Accepted
- **Date:** 2026-06-10
- **Deciders:** founder, Claude (agent)
- **Related D-decisions:** D157 (BullMQ), D203/D225 (worker policies),
  D158 (hosting stack), D156 (rate limiting), D159 (observability)
- **Related ADRs:** ADR-0022 (Supabase pre-launch), ADR-0005 (Gmail
  quota rate limiter)

## Context

2026-06-09/10 incident: the always-on Cloud Run worker (BullMQ, 9
consumers polling) consumed Upstash Redis free tier's **500K
commands/month cap in ~1 day**. Upstash stopped accepting commands;
the entire async layer (sync, triage jobs, undo expiry, everything
BullMQ-backed) was down **41 hours** before the founder found it by
hand. No alert fired anywhere.

Root causes, in order of blame:

1. **Redis commands were never treated as a metered resource.** BullMQ
   consumers poll continuously even when idle; on a per-command billing
   model, idle polling IS spend. No limiter bounded it, no alert
   watched it.
2. **The 2026-06-08 `min-instances=1` + `--no-cpu-throttling` change**
   (which made the worker genuinely always-on) was costed for Cloud Run
   dollars but not for the Upstash command meter it would now run 24/7.
3. **Zero usage monitoring on any vendor.** Upstash was the vendor
   that broke first, but Anthropic, GCP, Supabase, Vercel, Sentry,
   PostHog, and GitHub Actions all had the same blind spot.

The structural lesson: **per-command serverless Redis billing is
incompatible with an always-on BullMQ poller.** The workload's idle
floor is a continuous command stream; any plan that meters commands
turns a polling misconfiguration directly into spend (PAYG) or an
outage (free-tier cap). The same class of failure exists, in milder
form, on every metered vendor we use.

Founder directive: guardrails on EVERY metered vendor + daily
visibility.

## Decision

Three parts, taken together:

1. **Move Redis to the Upstash Fixed 250MB plan ($10/mo, flat).**
   Command volume becomes a rate limit (10K commands/sec — throttles,
   never bills) instead of a billing meter. A future polling bug now
   degrades to throttling, not a bill and not a 41h dead queue.
2. **Tune BullMQ polling down via worker env** (`packages/workers`),
   so the idle command floor shrinks regardless of which Redis plan
   sits underneath. Plan choice and command volume are independent
   defenses.
3. **Adopt the three-layer guardrail posture on ALL metered vendors:**
   vendor-side hard cap (survives our bugs) > vendor-side alert >
   app-side limiter + daily watchdog (`scripts/check-vendor-limits.mjs`
   via `.github/workflows/vendor-limits-watchdog.yml`; a breach fails
   the run so GitHub emails the founder). Operator manual:
   `docs/runbooks/billing-guardrails.md`.

## Alternatives considered

- **Stay on Upstash pay-as-you-go (unbounded or budget-capped):**
  rejected — keeping a billing meter coupled to idle polling behavior
  is anti-guardrail. Even with the PAYG budget cap, hitting the cap
  rate-limits the database, which reproduces the incident's outage
  mode; and below the cap, a polling bug converts directly into spend.
- **GCP Memorystore Redis (~$45-60/mo basic tier):** deferred until
  scale. Same-cloud latency and no command metering at all are real
  wins, but it is 4.5-6x the Fixed-plan cost at pre-launch volume
  with zero users. Revisit when throughput approaches the 10K cmd/sec
  rate limit or when the ADR-0022 Cloud SQL migration triggers fire
  (consolidating onto GCP at that point is natural).
- **Railway/Render flat-rate Redis:** viable fallback if Upstash Fixed
  misbehaves (e.g., rate-limit throttling interacts badly with BullMQ
  blocking semantics). Not chosen now — it adds a vendor without
  adding a capability, and Upstash Fixed is already flat-rate.

## Consequences

### Positive

- Redis spend is bounded by the plan price; the meter that caused the
  incident no longer exists as a billing dimension.
- Failure mode improves: command spikes throttle instead of killing
  the queue for the rest of the month or running up a bill.
- Daily watchdog gives founder-visible usage on every vendor — drift
  is caught in days, not at outage time.
- The guardrail posture generalizes: any future vendor (Resend, Stripe
  fees aside) joins the matrix with a known checklist.

### Negative

- $10/mo fixed even while idle (vs $0 free tier — but the free tier
  demonstrably cannot host this workload).
- 10K commands/sec is a real throughput ceiling. Far above current
  load, but it is now the scale trigger to watch (see Memorystore
  deferral above).
- The watchdog introduces ~8 read-only vendor tokens to provision and
  rotate (to be inventoried in `secrets-inventory.md` when the founder
  creates the tokens — see FOUNDER-FOLLOWUPS 2026-06-10); a stale
  token means a skipped check, which the workflow surfaces as a
  warning rather than a pass.

### Neutral

- GCP remains alert-only — no hard cap exists on GCP billing. The
  compensating controls are the $30 budget's Pub/Sub feed (read by
  the watchdog), the log-based alert on the BullMQ cap error
  (`scripts/setup-billing-alerts.sh`), and Cloud Run `max-instances`.
- The Fixed plan's 250MB storage cap becomes a watched metric (BullMQ
  completed/failed job retention must stay bounded).

## Implementation notes

- Runbook (matrix, founder click-paths, incident playbook):
  `docs/runbooks/billing-guardrails.md`.
- Watchdog: `scripts/check-vendor-limits.mjs` +
  `.github/workflows/vendor-limits-watchdog.yml` (daily cron).
- GCP log-based alert: `scripts/setup-billing-alerts.sh`.
- Polling tuning: env-driven BullMQ settings in `packages/workers`.
- Secret rows for watchdog tokens: to be added to
  `docs/runbooks/secrets-inventory.md` when the founder creates the
  tokens (see FOUNDER-FOLLOWUPS 2026-06-10).

## References

- `docs/runbooks/billing-guardrails.md` — operator manual for this ADR
- ADR-0022 — the same cost-posture re-examination for Postgres
- `docs/execution/launch-gap-audit-2026-06-09.md` — audit session that
  surfaced the incident
- Upstash pricing/budget docs: upstash.com/docs/redis/overall/pricing
