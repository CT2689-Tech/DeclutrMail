# Quiet Hours HTTP and browser journey

The existing configuration and timezone suites cover state math, co-tenancy,
midnight boundaries and DST, but the required product-journey lane did not execute
Quiet Hours save/reload/recovery against the real API. Enroll one synthetic flow:
enable22:00–07:00 America/Los_Angeles, assert cross-midnight copy, await real PUT200,
read API/DB state, reload, reject a browser PUT503 before the server, assert feedback
and unchanged stored settings, reload the actual prior value, retry successfully,
disable and verify persisted reload/API readback.

Fixture identity is enforced before writes by requireLiveStack and isolated db
configuration; applyJourneySeed refuses non-synthetic mailboxes. Only the fixed
synthetic mailbox is used, no OAuth tokens, worker or provider. The test snapshots
quiet_state, merges its configuration and one owned co-tenant marker, checks that
sibling survives the real save, and restores only those two keys after the test.
Sibling keys are never replaced by cleanup. The rejected-write seam is a controlled
transport error, not a claim that production backend or Gmail failed.

Root owns the new spec and package/required-report registry plus report fixture.
Based on main5620e01a, independent of the explanation/context PRs. Relates to D92,
D95 and D245. No product, database, billing provider or onboarding changes. Rollback:
revert test-only PR; do not rename/remove the existing required CI producer.

E2E typecheck,21 harness contracts, formatting and targeted lint pass. Read-only
review cleared fixture ownership/restoration, response timing and assertions.
Local Docker server did not respond within10s; full HTTP/browser execution is
pending CI and must not be called passed before that exact candidate succeeds.
Previously24 timezone/state tests passed, including spring/fall DST and co-tenancy;
this new journey does not itself run clock-controlled DST or worker/Gmail deferral.
Production account verification remains separate.
