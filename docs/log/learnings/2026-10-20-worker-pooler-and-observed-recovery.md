## 2026-10-20 — Worker progress and observed recovery

**Context:** Google alert triage found no worker heartbeat or mailbox sync progress after 2026-10-20 06:06 UTC, while API database/Redis readiness stayed healthy.

**Finding:** A same-image worker replacement briefly resumed work, then hung again. The persistent postgres.js main pool used Supavisor transaction mode; Supabase documents pipelining-related hung or mismatched replies for that combination. Session mode avoids that unsupported combination. The actual session-client limit was 15, independent of PostgreSQL's 60 backend limit. An initial session-mode replacement with the old pool budgets failed `EMAXCONNSESSION`; production recovery required bounded pools and release of the previous instances. The recovery revision used 2 main + 1 lock + 1 listener clients. The permanent 3 + 3 + 1 budget allows 14 clients across a rolling pair.

**Verification:** The recovered worker recorded fresh successful billing-verdict, deletion-purge, snooze-wake and watch-renewal runs at 14:12 UTC. All eight valid connected mailboxes subsequently advanced their sync timestamps. One historical revoked Gmail grant remains a reconnect requirement. This establishes recovery, not the exact wire-level cause of the initiating hang. Continue observing the permanent release separately.

**Alert lesson:** `INACTIVE` closed scheduler alerts when telemetry vanished. Failure-only Logging counters can also receive synthetic zero intervals, so `NO_OP` alone is insufficient. Continuous explicit success observations provide recovery evidence; source absence remains a separate alert. A stuck-mailbox event window expiring is not confirmed mailbox recovery and must not send a recovery email.

**Enforcement:** Worker database/progress tests and an isolated native-PostgreSQL integration test; negative controls removing the session rewrite, reinstating heartbeat-to-collector gating, and restoring `INACTIVE` each fail. Cloud Run liveness observes completed database heartbeats rather than startup alone.

**Source:** [Supabase postgres.js guidance](https://supabase.com/docs/guides/database/postgres-js), [Cloud Logging zero values](https://docs.cloud.google.com/logging/docs/logs-based-metrics).
