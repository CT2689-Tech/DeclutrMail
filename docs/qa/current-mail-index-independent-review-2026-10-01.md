# Current-mail partial index — independent review

Candidate reviewed in `codex/current-mail-query-performance`, working tree based on `643082e329421219f3e7645ee96bcae69e64c64a` (`origin/main` / merged web PR #839). Read-only review of tracked delta and all untracked candidate files: migration 0081, rollback, Atlas checksum, `mail-messages.ts`, actual-service performance regression, and `docs/qa/first-navigation-performance-2026-10-01.md`. No reviewer source edits or production DB operations; tests use isolated synthetic PGlite databases.

Read CLAUDE gate definitions for privacy-auditor, architecture-guardian, schema-migration-reviewer and defect-class-sweeper. Applied the Supabase Postgres best-practices review skill (partial/composite indexes and EXPLAIN evidence). Reviewed actual `hasCurrentMail`, each call site, related detail reads and shared action predicates rather than only matching migration comments.

## Verdicts

- **Privacy audit: PASS, no blocking findings.** No column, Gmail request, body/header fetch, response projection, logging/analytics sink or privacy contract changed. The only index keys are existing mailbox ID and sender-key metadata. Synthetic fixture uses reserved example identities and no production mailbox contents.
- **Architecture guardian: PASS, no blocking findings.** Runtime API SQL and logic are unchanged. No Nest module/provider boundary, worker policy, cross-feature write, mutation, idempotency, undo journal, auth guard, rate limit or wire envelope change. Test logger captures only synthetic SQL/parameters within the isolated test; stdout emits statement numbers and elapsed times, not mailbox material.
- **Schema migration review: PASS, no blocking findings.** Forward is additive `CREATE INDEX CONCURRENTLY`, with Atlas `txmode none`; rollback is `DROP INDEX CONCURRENTLY IF EXISTS`. Keys and static predicate match the Drizzle declaration and actual reader exactly. Existing migrations are unchanged; checksum validation passed. No column/data drop, rewrite, new FK, RLS/privilege change, partitioning or undo/encryption change. Native apply/lint and rollback/reapply evidence was inspected; PGlite is not relied on for concurrent-build behavior.
- **Independent adversarial correctness review: PASS, no unresolved blocking findings.** Index changes access path, not live truth. Explicit production-migration approval and green exact-final-head CI remain prerequisites to queue/merge: `migration-apply.yml` applies this migration automatically on main push. This review grants neither approval nor production verification.

## Predicate, scope and maintenance analysis

`hasCurrentMail()` at `apps/api/src/senders/senders.read-service.ts:157` requires same mailbox ID, same sender key, `is_outbound = false`, and `NOT(label_ids && ARRAY['TRASH', 'SPAM', 'DRAFT', 'CHAT']::text[])`. Migration 0081 and Drizzle definition repeat the identical constant order and predicate. Mailbox and sender are the equality-prefix keys; there is no recency filter in the partial predicate, so archived inbound messages remain represented regardless of age. Empty label array qualifies; rows with any excluded label do not. Both `label_ids` and `is_outbound` are NOT NULL. Index entries are maintained transactionally on inserts, deletes and label/direction changes; this introduces no asynchronously updated or stale materialized count for action readers.

Four main statements retain their existing scope/count semantics: list rows, matching count, mailbox-wide filter axes, summary's cleanup-active expression. The summary additionally keeps its existing recency condition; adding an index does not widen that fact. Other-mailbox message rows cannot satisfy the same-key probe because mailbox ID is part of both correlation and index prefix. Existing sender records, historical totals, detail access, policies and recovery remain available when current-mail-only filtering is off. Current-mail policy joins and scope authorization are unmodified.

Existing semantic tests, now executed with the new index installed, cover Inbox → archived → Trash → Undo and new arrival, another mailbox with the same sender key, all four exclusions, outbound and no-message senders. No action mutation/preview reader is changed or supplied with a deferred write.

## Migration/retry/locking

The forward deliberately omits `IF NOT EXISTS`, matching existing migration 0070/0080 recovery practice: a failed concurrent build can leave an invalid index and must fail loudly rather than silently accept it. The companion concurrent rollback removes that artifact before retrying a failed migration. On a successful apply, the Atlas revision ledger controls whether a subsequent apply is necessary; the rollback file is an operator recovery artifact, not a new forward migration.

Concurrent creation allows normal sync/action writes while scanning/building and waiting for relevant transactions; it still consumes CPU/I/O and can wait on long-running transactions. The existing migration workflow has a ten-minute job limit and serializes migration jobs. Cancellation/failure therefore requires checking invalid index state before retry, as documented. No existing index is removed, so rollback preserves correctness and restores the prior performance characteristics.

**[INFO] Operational cost is real and unmeasured in production.** The new index contains all qualifying current inbound rows, including archived mail, which may be a large population on a mostly uncleared mailbox. It adds index storage, predicate evaluation and maintenance; read improvement in a mostly-Trash fixture is not a production read/write throughput result. Its predicate references columns already used by existing partial indexes, so it adds no new set of HOT-blocking columns, but does add another physical index to maintain. Index-only scans can still perform heap visibility checks; the inspected native after plan in fact reports 50 heap fetches. Capture production index size/validity, build duration and representative write/read behavior during approved rollout.

## Defect-class sweep

Class: **repeated live-mail existence/count reads use a general sender/date index and heap-filter excluded message states because the exact current-mail predicate has no matching partial index.** This excludes rolling-window analytics whose date range and historical semantics require a different access path, and Inbox-only predicates already covered by migration 0070.

Blast radius: four directly tested Senders service statements, plus compatible bounded detail/action readers whose production latency is unmeasured.

Proof of search:

```text
Query: rg -n 'hasCurrentMail|isOutbound.*false|TRASH.*SPAM.*DRAFT.*CHAT' apps/api/src packages/workers/src packages/db/src --glob '*.ts'
Seed: apps/api/src/senders/senders.read-service.ts:925 — totalMatchingConditions.push(hasCurrentMail())
Helper: apps/api/src/senders/senders.read-service.ts:157–166 — hasCurrentMail's correlated EXISTS and exclusion literal
Axes: shape ✓; producer/reachability ✓; consumers ✓; layer ✓; provenance skipped by sweeper's read/grep-only definition (current producer and migration history were inspected as review context)
```

0. **Known seed: matching-count seam.** Parent supplied a bounded production read-only EXPLAIN: 8,025 sender probes, 50,374 message buffer hits, 4,885.266ms; QA accurately identifies it as a seam rather than complete endpoint. Current literal, key correlation and missing matching index are verified from source. Trust 9/10 for the supplied observed before seam, no production after claim.
1. **List rows.** Uses `hasCurrentMail` before list limit (`:590`). Actual service statement is exercised and explained by the new test; local before/after proves compatible index use. Production full query remains unmeasured after. Trust 8/10.
2. **Filter-axis counts.** Uses `hasCurrentMail` in mailbox-wide axis aggregate (`:1048`), separate from the matching count; this is covered by its own actual statement/plan assertion. QA distinguishes cumulative deployed statistics from sampled request timing. Trust 8/10 for index mechanism.
3. **Summary cleanup-active.** Uses the same helper with aliased sender correlation (`:1256`); actual full summary is consumed then explained, so scalar work cannot be optimized away in a proxy `count(*)`. Trust 8/10.

Candidates killed rather than reported as discovered slow screens: bounded detail archived-count (`:1501`) and current-mail message pagination (`:1693`) have compatible exclusions but only target one resolved sender and retain other predicates/sort keys; no production bottleneck evidence establishes them as the same observed stall. Shared all-mail action predicates use the same label constant/order, so the index may assist those readers, but their execution cost is unmeasured and their mandatory-preview/mutation contracts are unchanged. Inbox-only probes already have a dedicated partial index; rolling historical counts intentionally include different states. No proven uncovered copy of the measured mechanism requires another runtime/query change.

## Independent verification

- Ran actual sender performance + semantic service suites independently: **2 files, 77 tests passed; 10 existing tests skipped**. Log `/tmp/declutrmail-current-mail-review-tests.log`.
- Independently observed all four actual-statement after plans selecting the new partial index. Three-run medians/maxima on this repeat: list **14.853 / 16.239 ms**, matching **0.311 / 0.443 ms**, axes **0.374 / 0.391 ms**, summary **13.403 / 13.900 ms**. No timing thresholds are asserted in the test.
- `atlas migrate validate --dir file://packages/db/migrations` and `git diff --check` passed independently.
- Inspected parent's full workspace typecheck pass, lint with zero errors/seven existing warnings, native Atlas 0081 lint with no diagnostics, native full apply through 0081, dry-run, native before/after plan JSON, and four failed pre-index negative-control assertions. DB suite/native rollback results are parent-provided evidence, not rerun by reviewer.
- Test observer fails closed: requires exactly four predicate-bearing SQL statements before evaluating their plans. It consumes semantic results, then explains original parameterized statements. A missing reader/predicate does not yield a vacuous green. `freshTestPglite` automatically closes the isolated handle at test completion.

## Measurement limits and approval boundary

The selective synthetic population (500 senders, 40,000 messages, only 50 qualifying archived messages) is intentionally unlike a fully populated uncleared mailbox. Native seam 9.181→0.597ms is one run per state, not a median/percentile. PGlite statement timings are three runs per state, but do not include HTTP, auth, pool wait, network, browser paint, or page interactivity. Neither proves a 200ms production page load. Production observations in the QA report and optional-read web benchmarks are carefully separated.

Production index size/write cost and after-read plans/page timings remain unverified. The rejected materialized grouped scan is absent from the candidate; no speculative query rewrite should be smuggled into this additive index change. Explicit approval is required before merging the migration PR, because the existing workflow auto-applies it. After approval, inspect index validity and fresh plans, measure representative actual service/endpoint reads and first/repeat browser navigation separately. No production DDL was performed by this reviewer.
