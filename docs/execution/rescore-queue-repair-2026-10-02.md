# Sender rescore queue repair

## Flow and ownership

After a sender-index sweep changes observed sender facts, eligible senders are
queued for rescoring. The score consumer updates verdicts used by Senders and
Autopilot; a queued job alone does not prove that evaluation completed. Protected
and held senders remain excluded by the existing sweep contract.

Root is the integration owner. This PR owns only the rescore ID helper, its real
Redis/BullMQ regression and this record. It has no dependencies on other open PRs,
does not modify readiness diagnostics, and changes no scoring policy, provider
permissions, mailbox content, schema or telemetry collection.

## Reproduced defect and repair

Production reported `sender_index_sweep.rescore_request_failed`. The helper joined
the mailbox, `subset` and a minute timestamp with colons. BullMQ rejects that custom
ID before enqueueing. Existing mocked-queue tests could not detect the rejection.

The replacement uses the existing rescore namespace and a colon-free minute tick.
The same mailbox/tick still deduplicates retries; different mailboxes or minutes
produce distinct jobs. A failed publish still leaves sweep evidence available for
the existing retry path. Publication remains outside the database transaction.

## Verification

- Negative control: a real Redis/BullMQ enqueue test failed against the old helper
  with `Custom Id cannot contain :`.
- After repair: all 40 tests in score worker registration, sender-index sweep
  worker and sweep queue suites passed using local Redis database 14. The new test
  proves actual enqueue, retry deduplication and isolation by mailbox/minute.
- Full repository typecheck and lint passed (existing lint warnings only).
  A frozen-lockfile install refreshed stale local dependency links before the
  web typecheck passed. Changed-file formatting and diff checks passed.
- Independent reviewer found no correctness, architecture or privacy blockers
  and independently reran the new real-Redis regression successfully. The stale
  score telemetry-ID comment identified by review was corrected.
- No production mailbox mutation or real score-provider call was made. This test
  proves queue acceptance and deduplication; production consumer completion and
  disappearance of the observed failure require post-deployment verification.

Onboarding and billing remain outside this audit. No production test residue was
created. Rollback is reverting the helper change; no migration is involved.
