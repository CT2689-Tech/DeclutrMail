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
 * The rewrite is keyed on the PARSED hostname + port, not a substring:
 * a path-less DSN (`…:6543?sslmode=require`), an uppercase host, or the
 * legacy `db.<ref>.supabase.co:6543` PgBouncer shape must all rewrite —
 * a silent miss here also silently disables the `SET lock_timeout`
 * guard, since `SET` is itself session state. Direct connections (local
 * dev, `db.<ref>.supabase.co:5432`) and non-Supabase hosts pass through
 * unchanged — they are already session-scoped. An unparsable DSN falls
 * back to the narrow string rewrite rather than throwing at boot.
 */
export function toSessionPoolUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    const host = url.hostname.toLowerCase();
    const supabasePooled =
      host.endsWith('.pooler.supabase.com') ||
      (host.startsWith('db.') && host.endsWith('.supabase.co'));
    if (supabasePooled && url.port === '6543') {
      url.port = '5432';
      return url.toString();
    }
    return databaseUrl;
  } catch {
    return databaseUrl.replace('.pooler.supabase.com:6543/', '.pooler.supabase.com:5432/');
  }
}

/**
 * `host:port` of a DSN for boot logs — enough to distinguish "correct
 * no-op" (direct dev DSN) from "prod pooler shape the match missed",
 * without ever logging credentials. Unparsable input logs as such
 * rather than risking a raw echo.
 */
export function safeHostPort(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}:${url.port || '5432'}`;
  } catch {
    return 'unparsable-dsn';
  }
}
