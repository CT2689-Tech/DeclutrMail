# ADR-0003: `BaseDeclutrWorker` is a framework-agnostic abstract class, not a NestJS `WorkerHost`

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** founder, Claude (agent), architecture-guardian gate
- **Related D-decisions:** D157 (BullMQ on Upstash), D203 (BaseDeclutrWorker abstraction), D225 (worker policy set)

## Context

PR-C (`feat/d157-initial-sync-worker`) builds the first DeclutrMail
worker — `InitialSyncWorker`, the full-mailbox metadata backfill —
together with the `BaseDeclutrWorker` base class that D203 mandates all
workers extend.

D203's body sketches the base class as `BaseDeclutrWorker extends
WorkerHost`. `WorkerHost` is from `@nestjs/bullmq` — extending it couples
the base class, and therefore every worker, to the NestJS dependency-
injection container and the `@Processor()` decorator.

`BaseDeclutrWorker` lives in `packages/workers` (per the CLAUDE.md repo
layout and `senders-backend-plan.md` §5). `InitialSyncWorker` also lives
there, and its concrete dependencies (`GmailClientService`,
`TokenCryptoService`) live in `apps/api`. The dependency direction must
be `apps/api → packages/workers`, never the reverse. Making
`packages/workers` depend on `@nestjs/bullmq` would pull a web-framework
runtime into a package whose only job is queue-worker logic, and the
worker runs as its own process (`apps/api/src/worker.ts`), not inside the
HTTP app.

D203's stated *core principle* is "standardize behavior, do not
centralize domain knowledge" — realized by an abstract class exposing
`processJob()` + a named policy + a single failure-capture seam. The
`extends WorkerHost` detail is an illustration of NestJS integration, not
the load-bearing part of the decision.

## Decision

`BaseDeclutrWorker` is a **framework-agnostic abstract class** — it does
not extend `WorkerHost` and `packages/workers` carries no NestJS
dependency. The BullMQ `Worker` is constructed in the composition root
(`apps/api/src/worker.ts`) and delegates each job to
`BaseDeclutrWorker.run()`. D203's core principle (abstract class,
`processJob()`, named `WorkerPolicy`, one failure-capture point) is
preserved in full; only the NestJS coupling is dropped.

## Alternatives considered

- **`extends WorkerHost` verbatim (D203 sketch)** — rejected: forces a
  `@nestjs/bullmq` + NestJS-DI dependency into `packages/workers`, and
  forces the worker process to boot a NestJS application context purely
  to instantiate workers. Disproportionate for a standalone process.
- **Move `BaseDeclutrWorker` into `apps/api`** — rejected: contradicts
  the CLAUDE.md repo layout (`packages/workers` = "BullMQ worker
  policies") and `senders-backend-plan.md` §5, and would make every
  future package-level worker depend on an app.

## Consequences

### Positive

- `packages/workers` stays a pure TypeScript package — no web framework,
  faster to typecheck, trivially unit-testable.
- The worker process is a plain composition root; no NestJS container
  boot, fewer moving parts.
- Dependency direction stays clean: `apps/api → packages/workers →
  packages/db`.

### Negative

- A literal reading of D203 (`extends WorkerHost`) is not followed — this
  ADR records the divergence so it is an owned decision, not drift.
- Workers are not auto-discovered by NestJS DI; the composition root
  wires each worker's dependencies by hand. Acceptable at one worker;
  revisit if the worker count grows large.

### Neutral

- `BaseDeclutrWorker.run(job)` is the integration seam — any queue
  runtime (BullMQ today) calls it. Sentry/PostHog emission (D159) routes
  through the single `captureFailure()` method when that wiring lands.

## Implementation notes

- `packages/workers/src/base-declutr-worker.ts` — the abstract class.
- `apps/api/src/worker.ts` — composition root; creates the BullMQ
  `Worker` and delegates to `run()`.
- If a later worker genuinely needs NestJS DI, prefer
  `NestFactory.createApplicationContext()` in that worker's composition
  root over re-coupling the base class.

## References

- `docs/execution/Implementation-Plan.md` — D203, D225
- `docs/execution/senders-backend-plan.md` §5 (PR-C spec)
- architecture-guardian gate review of PR-C (2026-05-22) — recommended
  this ADR
