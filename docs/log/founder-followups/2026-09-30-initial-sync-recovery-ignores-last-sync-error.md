### 2026-09-30 — `initialSyncRecovery()` never looks at `last_sync_error_code`/`last_sync_error_at`

**Source:** PR #763 merge-conflict resolution; a pre-existing test
(`sync-gate.test.tsx`, "offers Reconnect when a later background call proved
the grant is refused") asserted this worked and was removed here because it
doesn't — verified against current `initialSyncRecovery()`.

**Why:** `initialSyncRecovery({ errorCode, stuck, progressPct })`
(`packages/shared/src/contracts/initial-sync-recovery.ts`) classifies purely
on the CURRENT `error_code`. It never reads `last_sync_error_code` or
`last_sync_error_at`. Concretely: a mailbox whose most recent sync attempt
failed as `TransientError`, but whose most recent BACKGROUND check already
recorded `InvalidGrantError`, renders "Try again" — spending a retry attempt
against a grant already known to be dead, instead of "Reconnect Gmail".

**How:** decide whether this prioritization is wanted. If yes: extend
`initialSyncRecovery()`'s input to accept the last-known-error fields and
have it take the more recent/more severe of the two (needs a real design
call on tie-breaking and which timestamp is authoritative — see CLAUDE.md's
"provider event timestamps are not a total order" note before assuming
`last_sync_error_at > current attempt's own timestamp` is safe to compare
directly). If no: this is working as intended and nothing to do.

**Verifies by:** a test with `error_code: 'TransientError'` +
`last_sync_error_code: 'InvalidGrantError'` (more recent) asserting the
gate renders "Reconnect Gmail", not "Try again" — red today, would need
the above fix to go green.

**Status:** Open
