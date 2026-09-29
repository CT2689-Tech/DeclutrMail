## 2026-09-25 — Leaving skipped jobs out of batch counts made "0 of 0" read as "all failed"

**PR:** pending (worktree `upbeat-wiles-416cdd`)
**Caught by:** pill test for a one-sender skip, before merge
**What happened:** Once the batch status left skipped jobs out of `total`/`done`/`failed`, a one-sender skip reported `total: 0, failed: 0`, and the pill's `failed === total` check said "Delete failed". The same change first left `requestedCount` counting skipped senders, so the pill would also have said "some email not changed" about them.
**Correct approach:** `total > 0 && failed === total`; `requestedCount` covers the same jobs as `affectedCount`.
**Rule:** When a count's population changes, re-check every comparison against it for the empty case — the CLAUDE.md §8 "guard that cannot fail" tell, in its arithmetic form.
**Enforcement update:** `in-flight.test.tsx` one-sender-skip case; API spec for `requestedCount`.
