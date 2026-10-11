# Brief ready email: opt-in counts and owned inbox link

Owner: Codex journey-followups session in isolated a4ca. User approved explicit
opt-in, existing local delivery hour, aggregate counts and a Brief link, without
Gmail content. D261 records this decision separately from withdrawn D61.

## Completed story

Settings starts Off for legacy and new users. Explicit On captures a consent
revision atomically, persists after reload, and leaves old opt-outs alone.
All-unsubscribe invalidates consent even on the older compatibility API; Settings
shows effective Off. Unrelated category toggles cannot renew consent.

The existing daily snapshot producer catches up a lost enqueue from the same
frozen run. Identifier-only jobs use the separate `brief-email-send` queue and
stable run ID. Execution rechecks valid explicit consent, owned mailbox/user,
Pro capability, active connection, scan readiness, deletion state, current local
date/hour and nonempty valid snapshot. The fresh template contains counts and an
owned app-host Brief link; queued bodies and headers cannot supply Gmail content.
Disabled/suppressed/permanent/transient deliveries never set `email_sent_at`.
Acknowledged delivery sets the marker; lost-ack retry regenerates identical
content/headers/key. Real Redis dedup proves one fake-provider acceptance.

Export contains acknowledged local delivery dates only. Mailbox/account purge
removes owned jobs and events; Redis outages do not block database purge. A bounded
broker sweep discovers orphan identifiers afterward. Its per-state cursor handles
completed/failed/paused jobs, survives restart and never exceeds 100 jobs per page.
The data inventory and processor disclosure describe the new counts-only notice.

## Evidence and limits

- Shared consent/preference contracts: 16 tests pass.
- API/owner/export/unsubscribe/users/probe: 103 tests pass, including 30 owner
  tests with real PGlite and real Redis, fake email provider only.
- Effective Settings GET/PATCH: 33 tests pass after the display correction.
- Workers: 116 tests across email, snapshot, deletion and real transport pass.
- Settings UI: 52 tests pass. Full workspace typecheck passes. Lint: zero errors,
  six pre-existing warnings. Production build: 45 prerender checks, 51 route
  budgets pass (Billing 270.2/270.5 kB before main integration).
- Built-in browser, visibly identified synthetic account: keyboard On, reload
  remains On; keyboard Off restores the original preference. Desktop and 390px
  phone layout inspected; screenshot saved locally outside the repository.
- Independent review found/fixed sparse API forwarding, legacy toggle fallback,
  per-state cleanup pagination and effective consent display. Final protocol,
  privacy/security and architecture source review has no remaining findings.

Historical failures retained: initial owner queue cleanup used BullMQ's removed
Queue.client; fixed via its supported backend client. Initial protocol typecheck
failed two test-only preference-bag access types; corrected. A local build and
local dev restart failed ENOSPC from this session's inactive test copies. Only
owned inactive copies were removed; the recovered build passes. No assertion,
retry budget or required check was weakened.

No actual email, Google OAuth grant, purchase or outside-user reconnect was
executed. Fake provider proves transport/state semantics, not Resend delivery.

## Integration and rollout

Foundation #937 is merged. Compatibility #939 must deploy first. Shared owners:
email preferences, UsersService merge, Brief owner, queue/worker composition,
exports/deletion/inventory, Settings and CI Redis service. No database migration.

Exact compatibility API/worker serving identity remains distinct from CI/merge.
The feature's private candidate-image probe unconditionally requires every generic
email actor to advertise the compatibility version, including when billing
notices are Off. Empty/old/mixed actors block deployment before producer writes.
After new category writes, rollback retains the compatibility floor. Required CI
and normal merge queue govern feature merge; release and broker proof remain
separate evidence to read back before reporting production verification.
