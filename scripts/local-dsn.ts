/** Refuse any DSN that is not a loopback Postgres. Ops scripts never target production. */
export function assertLocalOpsDsn(dsn: string, command: string): void {
  let host = '';
  try {
    host = new URL(dsn).hostname;
  } catch {
    throw new Error(`${command}: DATABASE_URL is not a URL`);
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local || /supabase/i.test(dsn)) {
    throw new Error(`${command} refuses non-local databases`);
  }
}
