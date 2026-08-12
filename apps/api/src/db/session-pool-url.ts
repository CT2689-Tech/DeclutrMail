/**
 * Rewrite a Supabase TRANSACTION-pooler DSN (`*.pooler.supabase.com:6543`)
 * to its SESSION-pooler sibling (`:5432`) for connections that carry
 * session-scoped Postgres state.
 *
 * WHY. In transaction mode Supavisor assigns a backend per transaction,
 * so anything scoped to the session silently lands on (or leaks from)
 * whichever backend happened to serve that one statement:
 *
 *   - `pg_advisory_lock` acquires on backend A; the later
 *     `pg_advisory_unlock` runs on backend B, returns false, and A keeps
 *     the lock while sitting idle in the pool — every subsequent
 *     destructive action / incremental sync on that mailbox then blocks
 *     on `pg_advisory_lock` until A's connection dies. Observed in prod
 *     2026-08-12: a 285-message Delete queued for 8m39s behind a leaked
 *     lock (all three mailboxes held one).
 *   - `LISTEN` subscribes backend-locally, so the outbox NOTIFY wake
 *     channel never fires and the dispatcher degrades to its 5s polling
 *     fallback without any error.
 *
 * Session mode (same pooler host, port 5432) pins one backend per client
 * connection — the semantics session-level locks and LISTEN require.
 *
 * The rewrite is deliberately narrow: only the documented Supabase
 * pooler host shape is touched. Direct connections (local dev,
 * `db.<ref>.supabase.co`) and anything else pass through unchanged —
 * they are already session-scoped.
 */
export function toSessionPoolUrl(databaseUrl: string): string {
  return databaseUrl.replace('.pooler.supabase.com:6543/', '.pooler.supabase.com:5432/');
}
