### 2026-09-29 — AutopilotActionWorker has no reconnect or deletion-pending gate

**Source:** orchestrating session, surfaced during PR #805/#786 review; founder approved via AskUserQuestion 2026-09-29.

**Why:** `AutopilotActionWorker` applies approved actions gated only on entitlement
and quiet hours (CLAUDE.md §7's "A capability guard is a REQUEST guard" class,
and a live instance of "Flow & state completeness" — every OTHER periodic
mailbox producer composes `notNeedingReconnect` and/or checks
`deletionPendingSql` before touching Gmail; this one doesn't). Concretely:
a mailbox mid-reconnect (last incremental sync failed on an invalid grant,
per `providerSyncState.lastIncrementalErrorCode`) or inside an account or
mailbox-data deletion's undo window still has its approved Autopilot
actions applied. The founder decision recorded is: skip both.

**How:** the real, exported predicates to compose are:
- `notNeedingReconnect` (`packages/workers/src/mailbox-reconnect.ts:43`) — the
  sweep-query form (an `or(...)` of SQL conditions).
- `deletionPendingSql` / `getSyncMailboxEligibility` (`packages/workers/src/deletion-pause.ts:49,86`) —
  the D232 chokepoint; status `IN ('pending','executing'[,'failed'])` covers the
  undo window through actual purge.

Note the correction on record: `sender-index-sweep.worker.ts` was cited
earlier in chat as an example of composing `notNeedingReconnect`. It does
**not** — its own comment says it deliberately spends no Gmail grant and
sweeps a reconnect-pending mailbox exactly as usefully as any other. That
citation was wrong; do not build against it. The two files above are the
real, verified sources (grepped and read before writing this entry).

**Verifies by:** a test that an approved match on a mailbox with
`lastIncrementalErrorCode = INVALID_GRANT_ERROR` (or a pending/executing
deletion row) is NOT applied by the worker, red without the added gate;
and that a healthy mailbox's approved match still applies unchanged.

**Status:** Open
