# Architecture Decision Records

This directory holds DeclutrMail's ADRs — technical decisions made
**during implementation** that are not already settled by a D-decision
in `docs/execution/Implementation-Plan.md`.

See `CLAUDE.md` §11 for the ADRs-vs-D-decisions split:

- **D-decisions** — product / architecture decisions made during
  planning. Locked in the plan. Source of truth.
- **ADRs** — technical decisions made during implementation
  (library choice, encoding format, queue impl, retry policy, etc.).
  Reference the D-decisions they implement; never re-derive them.

ADRs follow the template at [`0000-template.md`](./0000-template.md).
Status values: Proposed | Accepted | Superseded by ADR-NNNN.

## Index

| ADR | Status | Title | Implements |
| --- | --- | --- | --- |
| [0000](./0000-template.md) | Template | Template for new ADRs | — |
| [0001](./0001-drizzle-orm.md) | Accepted | Drizzle as the backend ORM | D11 |
| [0002](./0002-pr-b-unauthenticated-oauth-connect.md) | Accepted | PR-B unauthenticated OAuth connect flow | D14 |
| [0003](./0003-base-declutr-worker-framework-agnostic.md) | Accepted | `BaseDeclutrWorker` is a framework-agnostic abstract class, not a NestJS `WorkerHost` | D157, D203, D225 |
| [0004](./0004-d7-allowlist-amendment-data-capture.md) | Accepted | D7 storage-allowlist amendment — capture To/Cc + List-Unsubscribe + outbound tagging | D7, D9, D228 |
| [0005](./0005-gmail-quota-rate-limiter-resumable-backfill.md) | Accepted | Gmail quota — sliding-window rate limiter + resumable backfill | D5, D157 |
| [0006](./0006-unsubscribe-cascade-rfc8058-mailto-manual.md) | Accepted | Unsubscribe cascade — RFC 8058 one-click, mailto deferred manual, fallback none | D9, D230 |
| [0007](./0007-component-placement-rule.md) | Accepted | Component placement — lazy promotion + spec override | D198, D199 |

## Authoring an ADR

1. Copy `0000-template.md` to `NNNN-kebab-title.md` using the next
   sequential number.
2. Fill in status, date, deciders, and the related D-decision(s).
3. Reference D-decisions; do not re-derive them. If the ADR contradicts
   a D-decision, stop and surface as plan-drift (CLAUDE.md §3).
4. Add the row to the index above.
5. Open a PR — the ADR is reviewed alongside the code change that
   triggered it.
