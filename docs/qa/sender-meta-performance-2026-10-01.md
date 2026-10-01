# Senders default query metadata performance — 2026-10-01

Root Codex integration owner; isolated `codex/sender-meta-performance` based on `38841291beecddeb67b4f226f8ce6bfeab6be92d`. Owns `apps/api/src/senders/senders.read-service.ts`, its read and current-mail plan specs, two QA reports and the focused review-correction log. Independent of #844 Later reads, #845 Activity lineage and #836 readiness; the already approved current-mail index is live. No migration or shared-contract changes.

## Problem and change

Default Senders list metadata ran two parallel mailbox-wide aggregates with identical mailbox/current-mail membership: the matching count and the existing axis counts/MAX. The membership seam alone took 714–924 ms in two bounded production index-after probes; this is diagnostic motivation, not a timing of the complete metadata method. Concurrent duplicates also compete for database CPU and buffers.

Share the base mailbox/current-mail predicates. If matching has no extra composed predicate, reuse the existing axis total instead of executing a second identical count. All actual composed filters still execute the exact separate matching COUNT, and mailbox-wide axis counts/MAX retain their original scope. No estimates, cache, response changes, history removal or write changes. TotalMatching remains consequential for bulk-selection copy and is exact.

## Evidence

Two actual PGlite-driver negative controls (currentMailOnly off/on) seed archived current mail, cleared Trash mail, and the same sender key with current mail in another mailbox. Original code returns the expected matching/axis totals and global max, then fails the one-call assertion with two calls. Candidate returns the same values with one call. Category filtering still returns its exact matching total with unchanged mailbox counts/max and two calls.

- Root full Senders read suite: **78 passed / 10 pre-existing optional tests skipped**.
- API typecheck, changed ESLint, formatting and diff checks pass. Required privacy/architecture and independent correctness review PASS with 122 independent tests passed / 10 existing optional tests skipped across four files; exact-head CI remains required.
- No synthetic milliseconds or production percentage improvement is claimed for this patch. It proves removal of one duplicate full scan. Production-after endpoint timing remains pending deployment.

This does not remove the exact mailbox-wide axis query, row projection or summary endpoint; the product-wide 200 ms target remains unverified.

## Independent review correction

The independent gate found the existing current-mail plan test still assumed four default statements. It now proves three default statements and separately checks filtered matching (25 senders) versus absolute current-mail axes (50 senders), preserving both exact totals and index-plan coverage. The original extra-statement expectation was not bypassed: its eliminated scan is proven absent while its distinct filtered path is still exercised.

The final root read+plan run used a disposable Vitest alias to this candidate's DB sources/migrations, and passed **79 tests / 10 existing optional tests skipped** across two files. Shared dependency symlinks initially resolved the older parent checkout without migration 0081; that environment produced missing-index plan failures. The real candidate-local fixture retains all index assertions and passes all five captured plans. The alias was removed after verification.
