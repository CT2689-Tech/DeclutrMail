# WS4a capacity, alerts, rehearsal, and Dependabot

Branch `codex/ws4a-capacity-alerts`, built from `0ecda73e` on 11 October 2026.
Relates to D193, D158, D160, D181, D224, and D159. This record does not close
those decisions. WS4b is out of scope. PR #972 stays paused.

## What landed

- Worker deploy sizing is 2 vCPU and 2 GiB. Min and max instances stay 1.
  The orphan-guard pin and the billing-notice and probe lines are unchanged.
  API sizing stays 1 vCPU, 512 MiB, min 1, max 3.
- User-facing drain is 10s / 60s and cron drain is 60s / 300s, in the deploy
  env and as the unset user-facing fallback. The 60s fat-finger ceiling stays.
  Revisit on 10 November 2026.
- Runtime alerts, applied only by hand: initial-sync wait over 10 minutes,
  exhausted initial-recovery count, dead-letter growth over 5 new terminals
  an hour, worker memory-limit or container exit, Gmail `RateLimitError`
  over 30 events in 10 minutes, and OAuth callback failures (3 in 1 hour or
  more than 20% of starts in 24 hours).
- `scripts/rehearse-first-sync-load.ts` is synthetic and refuses production.
  The 14 October staging walk of qa1–qa5 is manual and separate.
- Dependabot rebase is disabled and each ecosystem is capped at 3 open PRs
  until 3 November 2026. The existing update groups stay.
- Push-to-main CI can skip only when a successful `merge_group` run exists
  for the identical SHA. That commit needs Chintan's policy OK.

## Decisions assumed

- API max 3 stays. Three instances at concurrency 80 is 240 in-flight
  requests. The one worker instance is the sync bottleneck. Raise the API
  max only if 5xx or latency alerts fire during the 14 October rehearsal.
- Worker cost is a linear reading of the workflow's 21 August 2026 figure:
  1 vCPU / 1 GiB always-on was $50.51 a month with no requests. Doubling
  CPU and memory is about +$50 a month, roughly $101 a month, not a new
  invoice. Idle Redis commands rise versus the July slowdown that suspended
  a $20 Upstash budget. That cost is a watch item, not a measured dollar
  figure.
- Recovery budget has no existing log line. The worker telemetry count is
  the signal. Initial-sync recovery behavior from #927 is unchanged.
- OAuth lives in `security_events`, not Cloud Logging. A structured line is
  written only after a successful insert, for `oauth.start` and
  `login.failure`, with a closed reason or `other`. No address, account, or
  request identity is logged. `signup.denied` is not logged.
- Dead-letter growth counts `worker.dead_lettered`, not `dead_letter.parked`.
- Gmail quota matches `RateLimitError` on `worker.failed` only. Each
  throw also emits `worker.retried` or `worker.dead_lettered`, so
  counting those lines would page at 16 throws. The 30-in-10-minutes
  figure is an initial guardrail, not a measured baseline.
- Mailbox-connect failures log `connect_failed` or
  `MAILBOX_OWNED_BY_OTHER_WORKSPACE`. Both are allowlisted. A normal
  worker `exit(0)` does not page.
- `--runtime --apply` refuses until a fresh `source=recovery` success
  exists. Apply after the Q1 deploy, not before.
- Squash merges produce a different SHA from the merge-queue run, so the
  identical-SHA short-circuit will not fire until the queued commit is the
  commit that lands. A different SHA is not treated as a match.

## Manual steps

Do not apply alerts or resize production from this change itself. The worker
size ships on the next `deploy-cloud-run` of this commit.

1. After that deploy, confirm the worker:
   `gcloud run services describe declutrmail-worker --region us-west1`
   shows 2 vCPU and 2 GiB, min 1, max 1.
2. Wait until a worker log contains
   `kind=ops.collection source=recovery success=1`.
3. Then apply, and retry if coverage refuses:
   `node scripts/setup-infra-alerts.mjs declutrmail-ai-prod --runtime --apply`
4. On 14 October, walk qa1–qa5 in staging using
   `docs/runbooks/first-sync-load-rehearsal.md`. Do not use production users.
5. Chintan decides whether the identical-SHA CI short-circuit is accepted.

## Checks

Negative controls were run against the pre-fix subjects: 1 vCPU sizing, the
60s drain fallback, a recovery count that included attempts below the limit,
a dead-letter count of 5, a Dependabot limit of 8, a production project id,
and a different SHA. Each failed the new assertion, then the fix was restored.
