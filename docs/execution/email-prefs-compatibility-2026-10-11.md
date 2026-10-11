# Email preference compatibility before Brief email

Owner: Codex journey-followups session in isolated a4ca worktree. Scope: shared
stored preference reader, atomic all-unsubscribe handler, generic email actor
marker and broker proof. No new email producer, provider send or live account
mutation. Related contracts: D162/D165. Brief email is a subsequent release.

The strict stored reader previously rejected a future category and restored
`reminders` and `syncComplete` defaults, resurrecting existing opt-outs. Stored
reads now ignore unknown categories; authenticated PATCH remains strict. Known
malformed values retain the existing fallback policy.

All-unsubscribe atomically turns known categories off and changes the opaque
`emailAllOptOutRevision`. A subsequent optional category must capture that revision
on explicit opt-in, and require an explicitly stored, valid matching opt-in
revision at execution time. Missing consent must fail closed. A compatible older
API can thereby invalidate future-category consent even though it cannot name
that category. Single-category links preserve the global revision.

Generic email actors advertise `email-prefs-v2:w:billing-queue-v1`. The existing
billing marker suffix remains valid. The new read-only broker check requires at
least one actor and rejects every unnamed/older actor, including mixed versions.

Verification: 7 shared contract tests, 12 real PGlite all/single-category
unsubscribe tests (including repeated invalidation and future keys), and a real
Redis mixed-actor/drain regression pass. Restoring the old strict stored reader
makes the new opt-out regression fail with reminders/syncComplete reset to true;
the fixed reader was restored. All 8 workspace typechecks pass. Lint has 0 errors
and 6 pre-existing warnings. Formatting and independent correctness/privacy/
architecture review pass. Required CI and merge queue remain authoritative.

Rollout dependency: deploy this compatibility release to API and worker before
any new category writes. Verify exact API serving identity/traffic and broker
actor compatibility; zero-traffic old workers may still consume queues. Once
future consent exists, rollback must retain this compatibility floor. Brief's
activation must independently enforce the broker proof before its rollout.
