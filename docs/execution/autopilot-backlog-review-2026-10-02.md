# Autopilot backlog review

## Flow and ownership

Discover pending suggestions → understand why/date → review newest or older page →
select/preview or skip → reconcile current queue → recover/revisit. Root owns the
API pending reader/controller and tests, shared metadata contract, web query/route,
row/group copy and stories, synthetic journey/registry and this record. No dependency
on other open PRs; no schema, billing, onboarding, worker or approval-policy changes.
Relates to D104, D203, D226, D245 and D251; uses ADR-0042.

## Repairs and useful data

The first 50 suggestions were the only reachable page. Add opaque keyset pagination
with newest/previous/older controls and one page at a time. Rows remain limited to
50, so selections retain the existing bound and do not silently widen approval.
Current offerable queue total and page rows share one read-only repeatable-read
snapshot with identical tenant, protection and current-evidence predicates.
PostgreSQL microsecond timestamp precision is preserved in continuation keys.
CodeQL identified query-parameter type confusion; non-string/oversized values now
fail before decoding, with array/object regressions and real repeated-query HTTP400
coverage. Malformed cursors fail HTTP400 before SQL; parameter binding retains ISO strings.

The UI says how many records are on this page and how many were waiting at the last
check. Rows show the existing match date in UTC. Counts are observations, not live
promises. Old API responses without metadata say total unavailable. Existing all-rule
approval still uses its own preview and cutoff; loaded page counts are not its scope.
Review selected remains page-local. New page or account clears selection/preview.

Review found two edge cases and both have regressions: A→B→A with the same QueryClient
could restore A's old cursor; account change now clears persisted cursor state. An
older page emptied by resolution must not say the whole queue is empty. It retains
the observed total and Newest recovery with page-specific copy. Previous/Newest stay
available during loading or failure; Older requires a ready continuation.

## Verification

102 API tests passed against PGlite with full migrations: 61 microsecond-tied records
cover 50+11 without duplicates/loss, totals after dismissal, Protected exclusion,
cross-mailbox isolation and controller validation. 96 combined Autopilot/Home tests
passed, including next/error/retry/newest/account cache and empty-page recovery.
Full typecheck/lint passed (six pre-existing warnings). 21 harness contract tests pass.

Storybook from this checkout on port6019: desktop and390×844 review count/date rows
and page-specific empty recovery wrap correctly. Tab from the review anchor focuses
Newest with a visible ring. Loading/error recovery inspected separately. No provider
writes or mailbox content used. Independent source review cleared the two edge cases,
snapshot/count scope and microsecond boundary. Final journey/registry review cleared fixture isolation and assertions; corrected
loading/error stories to use suggestions-section state with ready rules.

The new required synthetic HTTP/browser journey seeds61 owned review records and
asserts actual HTTP200 envelope/page50+11, unique coverage, dates, skips11 older rows
through UI/API, recovers to newest and verifies reload/persisted dismissals. It must
execute in CI before readiness. Local full stack remains blocked by the Docker test
database; this journey has not been run locally. CI/build/budget/browser gates pending.
Production behavior and provider completion remain unverified. Rollback: revert PR.

## Further opportunities

- Translate known rule signals into clear explanations; current reasons can read like
  internal variable names. Preserve unknown reasons without guessing their meaning.
- Add server-side rule/age filtering once backlog demand warrants it; client-only
  filters would conceal unseen pages. Needs a product choice on default order/filter.
- Surface durable run, held/skipped and provider-completion receipts only after the
  workers persist authoritative facts. Current match metadata is not proof of outcome.
