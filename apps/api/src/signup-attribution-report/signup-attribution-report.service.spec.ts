import { ServiceUnavailableException } from '@nestjs/common';
import { users, workspaces } from '@declutrmail/db';
import { freshTestDb } from '@declutrmail/db/testing';
import { SIGNUP_HEARD_FROM_VALUES } from '@declutrmail/shared/contracts';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { signupAttributionCountsQuery } from './signup-attribution-report.queries.js';
import {
  parseSignupAttributionCounts,
  SignupAttributionReportService,
} from './signup-attribution-report.service.js';

const OBSERVED = '2026-10-27T19:00:00.000Z';
const group = (channel: string | null, account_count: unknown, is_total = 0) => ({
  channel,
  account_count,
  is_total,
  observed_at: OBSERVED,
});

describe('signup attribution read aggregate', () => {
  it('reports a genuinely empty database as zero with an observed time', async () => {
    const db = await freshTestDb();
    const report = await new SignupAttributionReportService(
      db as unknown as ConstructorParameters<typeof SignupAttributionReportService>[0],
    ).getReport();

    expect(report).toMatchObject({
      totalAccounts: 0,
      answered: 0,
      skipped: 0,
      unanswered: 0,
      unrecognized: 0,
    });
    expect(Number.isFinite(Date.parse(report.observedAt))).toBe(true);
    expect(report.channels.map((channel) => channel.channel)).toEqual(
      SIGNUP_HEARD_FROM_VALUES.filter((channel) => channel !== 'skipped'),
    );
    expect(report.channels.every((channel) => channel.count === 0)).toBe(true);
  });

  it('executes the real grouped query and keeps Other text and identities out of the report', async () => {
    const db = await freshTestDb();
    const [workspace] = await db
      .insert(workspaces)
      .values({ name: 'Synthetic acquisition' })
      .returning();
    await db.insert(users).values([
      {
        workspaceId: workspace!.id,
        email: 'friend@example.test',
        signupAttributionHeardFrom: 'friend',
      },
      {
        workspaceId: workspace!.id,
        email: 'other@example.test',
        signupAttributionHeardFrom: 'other',
        signupAttributionHeardDetail: 'Private synthetic response',
      },
      {
        workspaceId: workspace!.id,
        email: 'skip@example.test',
        signupAttributionHeardFrom: 'skipped',
      },
      { workspaceId: workspace!.id, email: 'pending@example.test' },
    ]);

    const report = await new SignupAttributionReportService(
      db as unknown as ConstructorParameters<typeof SignupAttributionReportService>[0],
    ).getReport();

    expect(report).toMatchObject({
      totalAccounts: 4,
      answered: 2,
      skipped: 1,
      unanswered: 1,
      unrecognized: 0,
    });
    expect(report.channels.find((channel) => channel.channel === 'other')?.count).toBe(1);
    expect(report.channels.find((channel) => channel.channel === 'friend')?.count).toBe(1);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('@example.test');
    expect(serialized).not.toContain('Private synthetic response');
    expect(serialized).not.toContain(workspace!.id);
  });

  it('selects only the response category and aggregates, with an independent total in the same statement', () => {
    const query = new PgDialect().sqlToQuery(signupAttributionCountsQuery()).sql;
    expect(query).toContain('GROUPING SETS');
    expect(query).toMatch(/count\(\*\)/i);
    expect(query).toContain('signup_attribution_heard_from');
    expect(query).not.toContain('signup_attribution_heard_detail');
    expect(query).not.toMatch(/"email"|"id"|mail_messages|mailbox_accounts|preferences/);
  });
});

describe('signup attribution result validation', () => {
  it('supports both database driver result shapes and counts unknown categories without exposing them', () => {
    const rows = [
      group('friend', '2'),
      group('skipped', 1),
      group(null, 1n),
      group('unrecognized-private-category', '3'),
      group(null, '7', 1),
    ];
    const report = parseSignupAttributionCounts({ rows });
    expect(report).toMatchObject({
      observedAt: OBSERVED,
      totalAccounts: 7,
      answered: 5,
      skipped: 1,
      unanswered: 1,
      unrecognized: 3,
    });
    expect(JSON.stringify(report)).not.toContain('unrecognized-private-category');
    expect(parseSignupAttributionCounts(rows)).toEqual(report);
  });

  it.each([
    ['missing response', undefined],
    ['unsupported driver result', {}],
    ['empty rows', []],
    ['missing total', [group('friend', 1)]],
    ['inconsistent total', [group('friend', 2), group(null, 3, 1)]],
    ['duplicate total', [group(null, 0, 1), group(null, 0, 1)]],
    ['duplicate channel', [group('friend', 1), group('friend', 1), group(null, 2, 1)]],
    ['malformed count', [group(null, 'unknown', 1)]],
    ['negative count', [group(null, -1, 1)]],
    ['unsafe count', [group(null, '9007199254740992', 1)]],
    ['invalid grouping flag', [group(null, 0, 2)]],
    ['missing observation time', [{ ...group(null, 0, 1), observed_at: null }]],
    [
      'mixed snapshots',
      [group('friend', 1), { ...group(null, 1, 1), observed_at: '2026-10-27T19:01:00.000Z' }],
    ],
  ])('rejects %s instead of showing zero', (_name, input) => {
    expect(() => parseSignupAttributionCounts(input)).toThrow();
  });

  it('surfaces database failures as unavailable', async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error('Synthetic connection failure')) };
    const service = new SignupAttributionReportService(
      db as unknown as ConstructorParameters<typeof SignupAttributionReportService>[0],
    );
    await expect(service.getReport()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('surfaces an unreadable result as unavailable', async () => {
    const db = { execute: vi.fn().mockResolvedValue({}) };
    const service = new SignupAttributionReportService(
      db as unknown as ConstructorParameters<typeof SignupAttributionReportService>[0],
    );
    await expect(service.getReport()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
