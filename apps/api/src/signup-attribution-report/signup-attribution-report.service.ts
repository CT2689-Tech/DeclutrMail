import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  SIGNUP_HEARD_FROM_VALUES,
  SignupAttributionReportSchema,
  type SignupAttributionReport,
} from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { signupAttributionCountsQuery } from './signup-attribution-report.queries.js';

const CHANNELS = SIGNUP_HEARD_FROM_VALUES.filter((channel) => channel !== 'skipped');

/** Admin-only aggregate. Neither identity nor free-text answers leave the database. */
@Injectable()
export class SignupAttributionReportService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async getReport(): Promise<SignupAttributionReport> {
    try {
      return parseSignupAttributionCounts(await this.db.execute(signupAttributionCountsQuery()));
    } catch (cause) {
      // The global exception filter owns error reporting. Unknown data must never become zero.
      throw new ServiceUnavailableException(
        {
          code: 'SIGNUP_ATTRIBUTION_REPORT_UNAVAILABLE',
          message: 'Signup attribution is unavailable. Try again.',
        },
        { cause },
      );
    }
  }
}

function nonnegativeCount(raw: unknown): number {
  if (!(
    typeof raw === 'number' ||
    typeof raw === 'bigint' ||
    (typeof raw === 'string' && /^\d+$/.test(raw))
  )) {
    throw new Error('Invalid signup-attribution count.');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid signup-attribution count.');
  }
  return value;
}

/** Strict adapters for node-postgres and postgres-js; unavailable rows never mean an empty cohort. */
export function parseSignupAttributionCounts(result: unknown): SignupAttributionReport {
  const candidate =
    result !== null && typeof result === 'object' && 'rows' in result ? result.rows : result;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new Error('Missing signup-attribution aggregate.');
  }
  let totalAccounts: number | undefined;
  let observedAt: string | undefined;
  let skipped = 0;
  let unanswered = 0;
  let unrecognized = 0;
  let groupedTotal = 0;
  const counts = new Map<string, number>(CHANNELS.map((channel) => [channel, 0]));
  const seen = new Set<string | null>();

  for (const raw of candidate) {
    if (raw === null || typeof raw !== 'object') {
      throw new Error('Invalid signup-attribution row.');
    }
    const row = raw as Record<string, unknown>;
    const count = nonnegativeCount(row.account_count);
    const isTotal = nonnegativeCount(row.is_total);
    if (isTotal !== 0 && isTotal !== 1) {
      throw new Error('Invalid signup-attribution grouping.');
    }
    const time = row.observed_at;
    if (!(time instanceof Date || typeof time === 'string')) {
      throw new Error('Missing signup-attribution observation time.');
    }
    const timestamp = new Date(time).toISOString();
    if (observedAt !== undefined && observedAt !== timestamp) {
      throw new Error('Inconsistent signup-attribution observation time.');
    }
    observedAt = timestamp;

    if (isTotal === 1) {
      if (totalAccounts !== undefined || row.channel !== null) {
        throw new Error('Invalid signup-attribution grand total.');
      }
      totalAccounts = count;
      continue;
    }
    if (!(row.channel === null || typeof row.channel === 'string') || seen.has(row.channel)) {
      throw new Error('Invalid signup-attribution channel group.');
    }
    seen.add(row.channel);
    groupedTotal += count;
    if (row.channel === null) unanswered = count;
    else if (row.channel === 'skipped') skipped = count;
    else if (counts.has(row.channel)) counts.set(row.channel, count);
    else unrecognized += count;
  }
  if (totalAccounts === undefined || groupedTotal !== totalAccounts || observedAt === undefined) {
    throw new Error('Signup-attribution counts do not reconcile.');
  }
  const channels = [...counts].map(([channel, count]) => ({ channel, count }));
  const answered = channels.reduce((sum, channel) => sum + channel.count, unrecognized);
  return SignupAttributionReportSchema.parse({
    observedAt,
    totalAccounts,
    answered,
    skipped,
    unanswered,
    unrecognized,
    channels,
  });
}
