/**
 * Pure funnel SQL helpers. No database client, so tests can import this
 * without opening a connection.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SQL_PATH = join(dirname(fileURLToPath(import.meta.url)), 'sql', 'launch-funnel-report.sql');

export function assertLocalFunnelDsn(dsn: string): void {
  let host = '';
  try {
    host = new URL(dsn).hostname;
  } catch {
    throw new Error('launch-funnel-report: DATABASE_URL is not a URL');
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!local || /supabase/i.test(dsn)) {
    throw new Error('launch-funnel-report refuses non-local databases');
  }
}

export function funnelSql(freeAllowance: number, extraUserIds: readonly string[]): string {
  if (!Number.isInteger(freeAllowance) || freeAllowance < 0) {
    throw new Error('launch-funnel-report: free allowance must be a non-negative integer');
  }
  for (const id of extraUserIds) {
    if (!UUID.test(id)) throw new Error('launch-funnel-report: extra user id must be a uuid');
  }
  const source = readFileSync(SQL_PATH, 'utf8');
  const array =
    extraUserIds.length === 0
      ? 'ARRAY[]::uuid[]'
      : `ARRAY[${extraUserIds.map((id) => `'${id}'`).join(',')}]::uuid[]`;
  return source
    .replace(/-?\d+::int AS free_allowance/, `${freeAllowance}::int AS free_allowance`)
    .replace('ARRAY[]::uuid[] AS extra_user_ids', `${array} AS extra_user_ids`);
}

export function extraUserIdsFromEnv(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
