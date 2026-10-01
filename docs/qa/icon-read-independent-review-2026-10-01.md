# Icon read candidate — independent review

**Architecture gate: PASS. Optional privacy review: PASS. Independent adversarial correctness: PASS. No blocking findings.**

Workspace `/Users/chintant/.codex/worktrees/d523/DeclutrMail-icon-performance`, branch `codex/icon-read-performance`, base `643082e329421219f3e7645ee96bcae69e64c64a`. Reviewed owned service/spec and `docs/qa/icon-read-performance-2026-10-01.md`, with supporting schemas, controllers, optional guard and worker helpers read-only. No workspace source edits, external comments, merge or deployment by this reviewer. Temporary adversarial fixtures and this report were written outside the checkout.

SHA-256:

- `apps/api/src/icons/icons.service.ts`: `2e4ec0594c5a8290e3f480849e3fccc5ff2b28018efc37674c41c79c9f32ceee`
- `apps/api/src/icons/icons.service.spec.ts`: `0d65615ebd9a318c479a45030c6a6ba235a476d8368c3f37055470d3300ed496`

## Reader inventory

| Reader                                              | Data and absent/stale behavior                                                                  | Action/safety consequence                                                                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Individual `/api/icons/:domain` request             | Public bytes/MIME/strong ETag; cache miss returns 204/monogram; expired provider bytes excluded | Authenticated requests may schedule existing resolver work; anonymous requests cannot. No mailbox mutation.                         |
| Senders, Triage, Screener, Activity list decoration | Set of caller raw domain strings whose artwork is usable; absent membership omits image URL     | Cosmetic metadata only. Existing wrappers log failures and return empty decoration set without losing core rows.                    |
| Cache-resolution scheduling                         | Missing or stale canonical row plus exact discovery domain                                      | Same lookup-await and batch-detached policy, deadline, sampling cap and deduplication; domain validation remains before scheduling. |
| DomainIconWorker cache writer                       | Existing canonical job identity and discovery input                                             | Unchanged sanitization, resolution, provider policy and durable cache writes. No authoritative action is deferred by this change.   |

## Architecture Guardian — no findings

Applied CLAUDE §§7–8 and `.claude/agents/architecture-guardian.md`. Independent API typecheck and changed-file ESLint pass. Checks A–H find no new module/provider, worker policy, orchestrator, cross-feature write, event, undo wiring, endpoint, response envelope, mutation idempotency or rate-limit change. The global alias/cache read remains within IconsService; schema and writer ownership are unchanged. No systemic stop condition is touched. Schema, design and webhook gates do not fire for this diff.

## SQL and adversarial correctness

The helper at service lines 422–465 joins parameterized `(discoveryDomain, organizational)` input pairs to verified aliases and icons. Both primary keys are unique: each input has at most one verified alias and at most two matching icon rows. `OR` does not duplicate the same joined row when discovery equals canonical. No result ordering is relied upon: lookup chooses canonical identity from an invariant value across all rows for its single input, then indexes icons by their actual primary-key domain. Explicit `[discoveryDomain, canonical]` iteration preserves exact-domain priority regardless of database row order.

The confidence=100 condition lives in the alias LEFT JOIN. Lower-confidence aliases produce a null alias and organizational fallback, matching the former standalone alias query. Non-null canonical schema and the alias primary key make canonical identity stable across repeated organizational inputs. The icon LEFT JOIN preserves an input/canonical row when neither icon exists, including verified-alias cache misses; Drizzle maps the absent nested icon to null, which the service excludes from its icon Map. The existing unknown-domain and new mixed-batch cases exercise this mapping. No-map fallback merely preserves the former organizational identity.

Inputs are bound parameters; the input-column SQL identifiers are static. Existing candidate normalization remains in place. Canonical identity is still checked with the same `isResolvableDomain` gate before rendering/scheduling, even if the joined query has already read an exact icon. The read performs no DNS/HTTPS work and does not broaden outbound eligibility.

For batches, raw-domain keys are deduplicated before SQL, and distinct raw strings sharing normalized pairs remain valid output keys. Repeated canonical icon rows have identical values within this single statement snapshot; Map insertion order cannot change the selected artwork or availability. All-invalid/empty input still exits before constructing an empty VALUES statement. Each input contributes only metadata for at most two cache rows. Unlike the former unique-cache-key query, shared organizational inputs may repeat metadata rows, but page-bounded consumers keep this finite and artwork is excluded.

The batch projection substitutes SQL NULL for `image`, `mime` and `contentHash`; it never selects `domain_icons.image`. Its existing status/payload constraint makes status=ok sufficient for availability. Individual lookup still retrieves actual bytes and computes the same strong ETag. Existing freshness, legacy negative resolver version, 90-day ordinary TTL and 30-day Brandfetch rejection/fallback checks are unchanged. `now` acquisition timing remains unchanged in each method.

Lookup still awaits canonical scheduling before selecting/returning usable artwork. Batch still derives the same missing/stale canonical jobs, samples at most 12, logs its count and detaches the same Promise.all with rejection containment. Missing, negative, stale and queue-outage behaviors have not changed. Query failures propagate exactly as before; list wrappers retain their existing cosmetic fallback. No extra query, background write or new shared memoization is introduced.

Combining statements removes the interval in which alias and icon metadata could come from different PostgreSQL statement snapshots. It does not defer or introduce a writer. The artwork is read afresh per invocation, with the same pre-existing possibility of a subsequent worker refresh.

## Privacy and auth

Both tables remain global public-brand metadata with no user/mailbox linkage. No message body, recipient, token, additional mailbox projection or telemetry is read or logged. Availability sets remain keyed by the caller's input strings. Controller and guard are unchanged: optional JWT only grants scheduling eligibility when a session populates req.user; route-local 600/min rate limiting remains. Anonymous reads still share public artwork bytes but cannot cause outbound work. CSP, CORP, MIME, ETag/304, hit/miss cache controls and 204 semantics remain untouched. No decorative result authorizes Undo or another destructive action.

## Defect-class sweep (read consumers only)

Class: a read issues one SQL request to resolve public alias identity, then another request for cache rows that can be joined to that identity in one statement.

Confirmed blast radius: two already-known service methods (lookup and marksFor), covering the individual image route and four screen-list decoration readers. Both methods now use the same corrected helper. No other API read consumer of these two tables was found.

Proof of search:

```
Query: rg -n 'domainIcons|brandDomainAliases' apps/api/src --glob '!*.spec.ts'
Seed proof on unchanged HEAD: git show HEAD:apps/api/src/icons/icons.service.ts | rg -n 'const \[alias\] = await|const aliasRows = await|const rows = await'
Seed hits: lookup alias/cache at original lines 204/221; marksFor alias/cache at original lines 336/372.
Consumer search: rg -n 'marksFor\(|\.lookup\(' apps/api/src packages/workers/src
Axes: shape checked; reachability checked against validation and empty-batch exits; consumers checked; API/controller/worker layers checked read-only; provenance skipped under the sweeper read/grep-only role. No production DB population asserted.
```

Instance zero: individual lookup, fixed. Sibling: batch availability, fixed. Trust 8/10 for production performance impact: actual-driver query counts and synthetic response waits establish the mechanism; production speedup has not been measured. Cache writers are deliberately excluded from the optimization sweep, since moving writes would introduce a different correctness question. Auth/session checks and dependent core list reads are not duplicate cache reads and are not claimed as candidates.

## Independent checks

- Service/controller real-driver and HTTP suites: **46 passed, 1 skipped, 2 files**, 8.71s. Skip is the explicit optional benchmark. Expected error-path HTTP tests emit 401/500 logs while passing.
- Three additional isolated fixtures in `/tmp/declutrmail-icon-review-1k5l9v2j`: **3 passed**, 2.64s. Verified malformed canonical alias rejects both exact-image rendering and scheduling; verified-alias cache miss retains canonical identity and one enqueue for duplicates/shared alias; shared organizationals, uppercase raw strings, confidence99 alias and expired exact Brandfetch art preserve availability/fallback behavior.
- `pnpm --filter @declutrmail/api typecheck`: passed.
- Changed-file ESLint: passed without output.
- `git diff --check`: passed.

Logs: `/tmp/declutrmail-icon-review-tests.log`, `/tmp/declutrmail-icon-review-edge.log`, `/tmp/declutrmail-icon-review-typecheck.log`, `/tmp/declutrmail-icon-review-lint.log`.

The temporary fixture's first attempt used an unavailable cleanup export and incorrectly assumed the existing cheap domain gate rejects an IP-shaped name; those harness assumptions were corrected to use built-in fixture cleanup and an actually malformed canonical value. No product change was needed. Final checks above pass; no failed harness assertion is being reported as an introduced defect.

Integration-owner evidence: copied-main negative controls return the correct bytes/ETag and batch set but fail the required one-driver-call assertion (two calls); candidate passes in one call. With the opt-in identical 100ms-per-driver fixture, baseline lookup median212.54ms versus103.41ms, batch210.04ms versus103.38ms. All47 service/controller tests pass when the optional benchmark runs. These controlled waits support round-trip elimination, not SQL-engine speed, production requests or a sub-200ms screen claim. QA labels production-after measurement and native query-plan inspection pending; this reviewer did not independently run native PostgreSQL plans or benchmark timings.

## Final disposition

No unresolved architecture, privacy or independent correctness blocker. Ready for integration-owner final-head CI and authorized integration. Production-after request/navigation latency and native engine plan/throughput remain separate validation steps. This scoped candidate preserves visible/icon and scheduling semantics while removing one cache read round trip; it does not claim every screen is resolved.
