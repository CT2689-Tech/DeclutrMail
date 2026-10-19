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
  let host: string;
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

export interface FunnelWindow {
  cohortStart: Date;
  cohortEnd: Date;
  observedAt: Date;
}

export function funnelWindowFromEnv(env: Record<string, string | undefined>): FunnelWindow {
  const read = (name: string): Date | undefined => {
    const raw = env[name];
    if (raw === undefined) return undefined;
    const iso =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(raw);
    if (!iso) {
      throw new Error(`launch-funnel-report: ${name} must be an ISO timestamp with timezone`);
    }
    const value = new Date(raw);
    if (!Number.isFinite(value.getTime())) throw new Error(`launch-funnel-report: invalid ${name}`);
    const offsetMinutes =
      iso[2] === 'Z' ? 0 : (Number(iso[4]) * 60 + Number(iso[5])) * (iso[3] === '+' ? 1 : -1);
    const localClock = new Date(value.getTime() + offsetMinutes * 60_000);
    if (localClock.toISOString().slice(0, 19) !== iso[1]) {
      throw new Error(`launch-funnel-report: invalid ${name}`);
    }
    return value;
  };
  const observedAt = read('LAUNCH_FUNNEL_OBSERVED_AT') ?? new Date();
  return {
    cohortStart: read('LAUNCH_FUNNEL_COHORT_START') ?? new Date(0),
    cohortEnd: read('LAUNCH_FUNNEL_COHORT_END') ?? observedAt,
    observedAt,
  };
}

export function funnelSql(
  options: Partial<FunnelWindow> & { extraUserIds?: readonly string[] } = {},
): string {
  const observedAt = options.observedAt ?? new Date();
  const cohortStart = options.cohortStart ?? new Date(0);
  const cohortEnd = options.cohortEnd ?? observedAt;
  if (![cohortStart, cohortEnd, observedAt].every((date) => Number.isFinite(date.getTime()))) {
    throw new Error('launch-funnel-report: invalid report timestamp');
  }
  if (cohortStart >= cohortEnd || cohortEnd > observedAt) {
    throw new Error('launch-funnel-report: require cohort start < cohort end <= observed at');
  }
  const extraUserIds = options.extraUserIds ?? [];
  for (const id of extraUserIds) {
    if (!UUID.test(id)) throw new Error('launch-funnel-report: extra user id must be a uuid');
  }
  const source = readFileSync(SQL_PATH, 'utf8');
  const array =
    extraUserIds.length === 0
      ? 'ARRAY[]::uuid[]'
      : `ARRAY[${extraUserIds.map((id) => `'${id}'`).join(',')}]::uuid[]`;
  return source
    .replace('__COHORT_START__', cohortStart.toISOString())
    .replace('__COHORT_END__', cohortEnd.toISOString())
    .replace('__OBSERVED_AT__', observedAt.toISOString())
    .replace('ARRAY[]::uuid[] AS extra_user_ids', `${array} AS extra_user_ids`);
}

export function extraUserIdsFromEnv(raw: string | undefined): string[] {
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
