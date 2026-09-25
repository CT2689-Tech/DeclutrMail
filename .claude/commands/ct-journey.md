---
description: Trace a real user's journey — signup, Gmail connect, inbox scan, what they did, what broke — and turn it into fixes
argument-hint: '<email> | recent [days]   (bare = recent 30)'
---

Reconstruct what happened to a real user, from production data, in product
words. The report is not the point. The point is the defects and product gaps
their journey exposes, found and queued before the next user hits them.

- `/ct-journey <email>` — one user, end to end.
- `/ct-journey recent [days]` or bare — every signup in the window as a funnel
  (query F), then trace the **worst journey** in full: lost (never reached
  ready, or never acted and not seen for 3 days) beats degraded beats fine.
  Among equals, pick the one whose cause could still be live: run A for each
  (`u.id IN (…)`), take the error code and failure time, and check
  `git log --since=<failure> -i --grep=<error class or symptom>`. No fix merged
  since means live. Then pick the most recent.

## Rules — before the first query

1. **Read-only.** SELECTs and log reads. A fix, a grant or a retry is a
   separate step the founder confirms.
2. **Collect only what the report needs.** Never select subjects, snippets,
   sender addresses, domains or `sender_key` values (D7),
   `triage_decisions.reasoning`, or IP addresses. A user agent may be reduced
   to _mobile_ / _desktop_ in memory, never printed. Never write rows or log
   exports to disk — aggregate in the query or in memory. Mask every email
   except the one the founder named (`ab…@gmail.com`). The repo is public: a
   user's email never goes into a commit, PR, `FINDINGS.md` or task prompt;
   mailbox UUIDs may.
3. **A source proves only what it can see.**
   - Resend `delivered` means Gmail's server accepted it. Inbox or Spam is
     invisible — write "delivered, placement unknown" and ask the founder.
   - `worker.*` log lines carry a hashed `mailboxRef`, `http.request` lines no
     user at all, `reasoning.adapter_error` no mailbox. Anything tied to this
     user by time alone is labelled **by timing**.
   - No rows is not healthy. Logs keep 30 days (`_Default` bucket), Resend
     about as long: say **UNVERIFIED**. A lost user whose logs expire within
     48 h goes under **Your steps** with the expiry time.
   - The founder's own accounts and sessions share every source except
     query F. Their rows are noise; drop them before counting.
4. **Times in UTC.** The founder is on Pacific time; when the local date
   differs, give both once in the verdict.

## Steps

1. **Who** — query A. Recent mode: query F first (it returns ids), then A with
   `u.id = '<user_id>'` for the user you trace.
2. **Scan, recommendations and jobs** — the log side, in one command:

   ```bash
   node scripts/journey-logs.mjs <mailbox_id> --since=<signed_up minus 5 min>
   ```

   Scans (attempts, pace against our configured pace in force then, whether
   the first Gmail call ever succeeded), the ready email, recommendation runs
   (LLM vs template), action bursts, retries, lock timeouts, dead letters, long
   jobs, watchdog hits, and **OTHER lines** naming the mailbox. A failure's own
   line carries only an error class; the provider's reason (a Gmail 403
   `insufficientPermissions`) has turned up on another worker's OTHER line.
   Read one line of each failure kind and quote only its status and reason
   code. It derives the hashed ref itself; `--ref=` overrides. Exit 3 =
   UNVERIFIED.

3. **What they did** — query B (verbs, reach, undo, recommendations, Autopilot
   rules) and query C (did they follow the recommendation?). Autopilot vs
   by-hand is stored (`source`). Triage vs Senders is **not** — label actions
   log `source = manual` from both screens. For the screen, read the Cloud Run
   platform request log (`logName` ending `run.googleapis.com%2Frequests`) in
   their active minutes: request path around each `POST /api/actions`,
   device class from the user agent. Label it **by timing**; the founder's own
   sessions often share the window. One bulk click = many jobs in one second.
4. **Around them** — every read carries `timestamp>=` for the window (gcloud
   defaults to the last 24 h, which reads as a false zero on older journeys):
   - **Email:** Resend `list-emails` has no recipient filter. Match the address
     in memory and print only matching rows (kind, status, time). Do not call
     `get-email` — it returns the body and an unsubscribe token.
   - **Errors:** Sentry `search_issues` with `environment:production` and
     `lastSeen:-<N>d` covering the window (archived issues count too); filter
     worker issues by tag `worker:<Name>` or
     `mailbox_account_id:<ref>` (the same hashed ref). Free text finds nothing
     (messages are scrubbed); `search_events` has failed on this org. If the
     logs show failures Sentry has no events for, say so — it may be dropping.
   - **LLM:** the script's RECOMMENDATIONS section is the evidence tied to this
     mailbox. For the cause, read `jsonPayload.kind="reasoning.adapter_error"`
     in the window, grouped by day and by `status` + `type` (a single bucket
     hides when it started); one message names it, for example "credit
     balance".
5. **Is it just them?** — query F over 30 days. In recent mode, run step 4's
   email, error and LLM checks once for the whole window, plus the per-user
   Sentry tag search for the traced user only. One user's
   failure repeated across the cohort is the headline, not a footnote.

## Expected — flag anything off it

A slow scan at the configured pace is not "Gmail's limit" until the quota
meters say so. Read Cloud Monitoring `serviceruntime.googleapis.com/quota/limit`
and `quota/rate/net_usage` for `gmail.googleapis.com` over the scan: each
`quota_metric` has its own per-read cost and its own limit, and only the
limited one caps us. On 2026-09-25 that was `default` (5 units per read,
15,000/min per user), while the 20-unit `total_query_cost` was unlimited.

| Thing           | Expected                                                           | Where                       |
| --------------- | ------------------------------------------------------------------ | --------------------------- |
| Scan read pace  | the configured pace the script prints for that date                | journey-logs SCANS          |
| Gmail access    | the scan's first Gmail call succeeds                               | journey-logs SCAN_FAILED    |
| Scan outcome    | ready on attempt 1, `unreadable` 0                                 | journey-logs, `sync_runs`   |
| Ready email     | `sync-complete → sent` within seconds of ready                     | journey-logs EMAIL          |
| Recommendations | done within ~1 min of ready; LLM count above 0; a mix of verdicts  | journey-logs, query B       |
| Followed them?  | most actions match the recommendation                              | query C                     |
| Action job      | attempt 1, seconds; a retry means it waited 45 s on the lock       | journey-logs ACTIONS        |
| Background sync | no terminal failures, no job over 2 min                            | journey-logs FLAGS          |
| First action    | minutes after ready, not hours                                     | query B                     |

## Queries — Supabase `execute_sql`, project `hewwqjkvrngxbihciewr`

Substitute literals only after checking shape: email `^[^'\s]+@[^'\s]+$`,
ids UUIDs.

**A — who, and where they stand** (`WHERE u.email = …` or `WHERE u.id = …`)

```sql
SELECT u.id AS user_id, w.tier, u.created_at AS signed_up, u.onboarded_at,
       u.signup_attribution_heard_from AS heard_from,
       m.id AS mailbox_id, m.status, m.connected_at,
       s.readiness_status, s.current_stage, s.progress_pct, s.error_code,
       s.last_incremental_error_at, s.last_incremental_error_code,
       (SELECT count(*) FROM active_sessions a WHERE a.user_id = u.id) AS sessions,
       (SELECT max(last_used_at) FROM active_sessions a WHERE a.user_id = u.id) AS last_seen,
       (SELECT g.tier || coalesce(' until ' || g.expires_at::date, '')
          FROM entitlement_grants g WHERE g.email = u.email AND g.revoked_at IS NULL) AS comp,
       (SELECT json_agg(json_build_object('status', r.status, 'attempts', r.attempts,
                'finished', r.finished_at, 'emails', r.messages_synced,
                'ms', r.final_attempt_duration_ms, 'error', r.error_code) ORDER BY r.finished_at)
          FROM sync_runs r WHERE r.mailbox_account_id = m.id) AS scans
FROM users u
JOIN workspaces w ON w.id = u.workspace_id
LEFT JOIN mailbox_accounts m ON m.user_id = u.id
LEFT JOIN provider_sync_state s ON s.mailbox_account_id = m.id
WHERE u.email = '<email>';
```

**B — what they did** (one row per kind; no sender detail)

```sql
SELECT 'job' AS what, verb::text || '/' || reach::text AS kind, status::text AS state,
       count(*) AS n, sum(affected_count) AS emails, min(created_at) AS first_at, max(updated_at) AS last_at
FROM action_jobs WHERE mailbox_account_id = '<mailbox_id>' GROUP BY 2, 3
UNION ALL
SELECT 'activity', source::text || '/' || action::text,
       count(*) FILTER (WHERE reverted_at IS NOT NULL)::text || ' undone',
       count(*), sum(affected_count), min(occurred_at), max(occurred_at)
FROM activity_log WHERE mailbox_account_id = '<mailbox_id>' GROUP BY 2
UNION ALL
SELECT 'recommendation', verdict::text, generated_by::text, count(*), NULL, min(produced_at), max(produced_at)
FROM triage_decisions WHERE mailbox_account_id = '<mailbox_id>' GROUP BY 2, 3
UNION ALL
SELECT 'rule', coalesce(preset_key, 'custom'), mode::text || CASE WHEN enabled THEN '' ELSE ' (off)' END,
       count(*), NULL, min(mode_changed_at), max(mode_changed_at)
FROM automation_rules WHERE mailbox_account_id = '<mailbox_id>' GROUP BY 2, 3
ORDER BY first_at;
```

**C — did they follow the recommendation?** (counts only; never select `sender_key`)

```sql
SELECT a.verb::text AS did, coalesce(d.verdict::text, 'no recommendation') AS recommended,
       count(*) AS jobs, sum(a.affected_count) AS emails,
       count(DISTINCT date_trunc('second', a.created_at)) AS clicks
FROM action_jobs a
LEFT JOIN triage_decisions d
  ON d.mailbox_account_id = a.mailbox_account_id AND d.sender_key = a.selector->>'senderKey'
WHERE a.mailbox_account_id = '<mailbox_id>' AND a.direction = 'forward'
GROUP BY 1, 2 ORDER BY jobs DESC;
```

**F — funnel of recent signups** (masked; the founder's own accounts excluded)

```sql
WITH u AS (SELECT u.id, u.email, u.created_at, u.onboarded_at, w.tier
           FROM users u JOIN workspaces w ON w.id = u.workspace_id
           WHERE u.created_at >= now() - interval '<days> days'
             AND u.email NOT IN ('chintan.a.thakkar@gmail.com', 'chintan.a.thakkar.crypt@gmail.com')
             AND split_part(u.email, '@', 2) NOT IN ('declutrmail.ai', 'declutrmail.com'))
SELECT left(u.email, 2) || '…@' || split_part(u.email, '@', 2) AS who, u.id AS user_id,
       string_agg(DISTINCT m.id::text, ',') AS mailbox_ids,
       date_trunc('minute', u.created_at) AS signed_up, u.tier,
       min(m.connected_at) AS connected,
       string_agg(DISTINCT s.readiness_status::text, ',') AS scan,
       min(r.finished_at) AS scan_ok, max(r.messages_synced) AS emails,
       max(a.first_action) AS first_action, coalesce(sum(a.jobs), 0) AS jobs,
       coalesce(sum(a.emails), 0) AS emails_acted, coalesce(sum(a.failed), 0) AS failed_jobs,
       u.onboarded_at IS NOT NULL AS onboarded, max(ss.last_seen) AS last_seen
FROM u
LEFT JOIN mailbox_accounts m ON m.user_id = u.id
LEFT JOIN provider_sync_state s ON s.mailbox_account_id = m.id
LEFT JOIN LATERAL (SELECT finished_at, messages_synced FROM sync_runs
                   WHERE mailbox_account_id = m.id AND status = 'succeeded'
                   ORDER BY finished_at LIMIT 1) r ON true
LEFT JOIN LATERAL (SELECT min(created_at) AS first_action, count(*) AS jobs,
                          sum(affected_count) AS emails,
                          count(*) FILTER (WHERE status = 'failed') AS failed
                   FROM action_jobs WHERE mailbox_account_id = m.id) a ON true
LEFT JOIN LATERAL (SELECT max(last_used_at) AS last_seen FROM active_sessions
                   WHERE user_id = u.id) ss ON true
GROUP BY u.id, u.email, u.created_at, u.onboarded_at, u.tier
ORDER BY u.created_at DESC;
```

## Report — this shape, in this order

1. **Verdict** — one line: made it / stuck at _step_ / lost at _step_, plus the
   single biggest cause.
2. **Timeline** — `UTC | what they saw or did | evidence`, at most 12 rows.
3. **What they did** — verbs × emails, by hand or Autopilot, which screen
   (by timing), followed or overrode the recommendations, undo, whether they
   came back.
4. **What went wrong** — one entry each: what they experienced → cause →
   evidence → **lost user / degraded / ops-only** → fix. Mark **by timing** and
   **unverified**. Anything touching a CLAUDE.md §2 Tier 1 area says so.
5. **Is it just them?** — the funnel, one line, plus any finding seen on other
   mailboxes.
6. **Next** — each defect class gets a task chip (`spawn_task`: self-contained,
   mailbox UUID not email) or `/ct-class`. Founder-only actions (billing, DNS,
   provider consoles, re-running someone's scan) go under **Your steps**.
