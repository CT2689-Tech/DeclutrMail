# First-sync load rehearsal

The script `scripts/rehearse-first-sync-load.ts` is a synthetic, in-process
stand-in for one worker instance. It does not call Gmail, Postgres, or Redis,
and it does not accept a production-users run.

CI checks the fast path:

```
pnpm exec tsx scripts/rehearse-first-sync-load.ts --mailboxes 3 --fast
```

The report prints `mailboxes`, `emails`, `queueWaitP50Ms`, `queueWaitP90Ms`,
`completionP50Ms`, `completionP90Ms`, `peakRssBytes`, and `failures`.

## Wednesday 14 October 2026, staging

Walk five staging mailboxes, `qa1` through `qa5`, after the launch worker
sizing is on the staging revision you intend to copy. This walk is manual.
The synthetic script does not connect those mailboxes and must not be aimed
at production users.

1. Confirm the target project is staging, not `declutrmail-ai-prod`.
2. Connect `qa1` through `qa5` through the product's normal OAuth flow.
3. Record queue wait, completion, worker memory, and any failed initial sync
   from the existing worker logs and the initial-sync queue.
4. Disconnect the QA mailboxes when the walk is finished.

Refuse the script when `GOOGLE_CLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT_ID` is
`declutrmail-ai-prod`, when `--production-users` is passed, or when
`DATABASE_URL` is a hosted Supabase URL unless `--fast` is set. `--fast` still
does not open that URL.
