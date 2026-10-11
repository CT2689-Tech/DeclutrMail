# Stuck initial scans

Read-only report, then one mailbox at a time. Do not run either command against production from a laptop. After the Q4 deploy, Chintan or Ops runs them for the two known stuck accounts (one `RateLimitError` since Aug 26, one `TransientError` since Sep 4).

Both commands refuse a non-local `DATABASE_URL` (no Supabase host, no remote host). Point them at a tunnel or a local copy only when that copy is the intended target, and say so in the command you actually run.

## Report

```bash
pnpm exec tsx scripts/stuck-scans-report.ts
```

Prints failed initial scans: mailbox id, error class, recovery attempts, next deadline (`initial_retry_at`), and whether the owner has finished onboarding. Incremental failures are not listed. The output has no email address.

## Requeue

```bash
pnpm exec tsx scripts/requeue-scan.ts --mailbox <uuid>
pnpm exec tsx scripts/requeue-scan.ts --mailbox <uuid> --confirm
```

The first command is a dry run. It prints the error class and writes nothing.

`--confirm` calls `SyncService.retryFailedInitialSync` for that one mailbox. It does not reset credentials and does not bypass the auth fence. `InvalidGrantError`, `AuthExpiredError`, and `ProviderPermissionError` are refused before that call. A requeue writes one `security_events` row, `eventType` `sync.manual_requeue`, with the mailbox id, the prior error class, and the outcome. No email address is stored.
