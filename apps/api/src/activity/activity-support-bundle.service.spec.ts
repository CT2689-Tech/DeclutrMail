import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVITY_SUPPORT_CSV_COLUMNS,
  ACTIVITY_SUPPORT_TECHNICAL_FILTER_KEYS,
  ACTIVITY_SUPPORT_TECHNICAL_RECORD_KEYS,
  ACTIVITY_SUPPORT_TECHNICAL_ROOT_KEYS,
} from '@declutrmail/shared/contracts';

import type { DrizzleDb } from '../db/db.module.js';
import type { ActivityReadService } from './activity.read-service.js';
import {
  ActivitySupportBundleService,
  type CreateActivitySupportBundleParams,
} from './activity-support-bundle.service.js';
import type { ActivityRow } from './activity.types.js';

const GENERATED_AT = new Date('2026-07-15T06:00:00.000Z');

const ROWS: ActivityRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    occurredAt: '2026-07-14T05:00:00.000Z',
    source: 'manual',
    action: 'archive',
    affectedCount: 4,
    sender: {
      senderKey: 'secret-sender-key',
      displayName: '=Formula Sender',
      email: 'john@example.com',
      domain: 'example.com',
    },
    rule: null,
    feedbackRating: null,
    undoState: {
      kind: 'available',
      token: 'secret-undo-token',
      expiresAt: '2026-07-20T05:00:00.000Z',
    },
    executionState: null,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    occurredAt: '2026-07-13T05:00:00.000Z',
    source: 'manual',
    action: 'delete',
    affectedCount: 0,
    sender: null,
    rule: null,
    feedbackRating: null,
    undoState: { kind: 'unavailable' },
    executionState: {
      kind: 'failed',
      actionId: '22222222-2222-2222-2222-222222222222',
      rootActionId: '33333333-3333-3333-3333-333333333333',
      requestedCount: 2,
      errorCode: 'GMAIL_PROVIDER_ERROR',
      resolution: 'support',
    },
  },
];

function makeService(
  mailboxes: Array<{ id: string; email: string; status: 'active' | 'disconnected' }> = [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'owner@example.com',
      status: 'active',
    },
  ],
  rows: readonly ActivityRow[] = ROWS,
) {
  const limit = vi.fn(() => Promise.resolve(mailboxes));
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit })),
      })),
    })),
  } as unknown as DrizzleDb;
  const reads = {
    captureIterationSnapshot: vi.fn(() => Promise.resolve({})),
    iterateActivity: vi.fn(async function* () {
      yield* rows;
    }),
  } as unknown as ActivityReadService;
  return { service: new ActivitySupportBundleService(db, reads), reads };
}

async function unzipBundle(stream: NodeJS.ReadableStream): Promise<Record<string, string>> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]));
}

const FILTERS: CreateActivitySupportBundleParams['filters'] = {
  window: '30d',
  source: null,
  verbs: ['archive', 'delete'],
  senderQuery: 'private-search@example.com',
  dateFrom: null,
  dateTo: null,
};

describe('ActivitySupportBundleService', () => {
  it('streams a privacy-safe human bundle with masked addresses by default', async () => {
    const files = await unzipBundle(
      await makeService().service.createBundle({
        workspaceId: 'workspace-1',
        mailboxAccountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filters: FILTERS,
        includeFullSenderAddresses: false,
        includeTechnicalDetails: false,
        generatedAt: GENERATED_AT,
      }),
    );

    expect(Object.keys(files).sort()).toEqual(['activity.csv', 'summary.txt']);
    expect(files['activity.csv']!.split('\n')[0]).toBe(ACTIVITY_SUPPORT_CSV_COLUMNS.join(','));
    expect(files['activity.csv']).toContain('j***@example.com');
    expect(files['activity.csv']).toContain("'=Formula Sender");
    expect(files['activity.csv']).toContain('Delete failed');
    expect(files['activity.csv']).toContain('Failed · support required');
    expect(files['activity.csv']).not.toContain('john@example.com');
    expect(files['activity.csv']).not.toContain('GMAIL_PROVIDER_ERROR');
    expect(files['activity.csv']).not.toContain('secret-undo-token');
    expect(files['summary.txt']).toContain('Mailbox: owner@example.com');
    expect(files['summary.txt']).toContain('Records: 2');
    expect(files['summary.txt']).toContain('Sender search: Applied');
    expect(files['summary.txt']).not.toContain('private-search@example.com');
  });

  it('adds independently opted-in full addresses and exact technical fields', async () => {
    const files = await unzipBundle(
      await makeService().service.createBundle({
        workspaceId: 'workspace-1',
        mailboxAccountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filters: FILTERS,
        includeFullSenderAddresses: true,
        includeTechnicalDetails: true,
        generatedAt: GENERATED_AT,
      }),
    );

    expect(files['activity.csv']).toContain('john@example.com');
    const technical = JSON.parse(files['technical-details.json']!) as Record<string, unknown>;
    expect(Object.keys(technical)).toEqual(ACTIVITY_SUPPORT_TECHNICAL_ROOT_KEYS);
    expect(Object.keys(technical.filters as object)).toEqual(
      ACTIVITY_SUPPORT_TECHNICAL_FILTER_KEYS,
    );
    const records = technical.records as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    for (const record of records) {
      expect(Object.keys(record)).toEqual(ACTIVITY_SUPPORT_TECHNICAL_RECORD_KEYS);
    }
    expect(records[0]).toMatchObject({
      activityId: '11111111-1111-1111-1111-111111111111',
      actionAttemptId: null,
      executionStatus: 'completed',
      errorCode: null,
    });
    expect(records[1]).toMatchObject({
      activityId: null,
      actionAttemptId: '22222222-2222-2222-2222-222222222222',
      executionStatus: 'failed',
      errorCode: 'GMAIL_PROVIDER_ERROR',
    });
    expect(files['technical-details.json']).not.toContain('secret-sender-key');
    expect(files['technical-details.json']).not.toContain('secret-undo-token');
    expect(files['technical-details.json']).not.toContain('33333333-3333-3333-3333-333333333333');
    expect(files['technical-details.json']).not.toContain('private-search@example.com');
  });

  it('masks a sender address that the read model used as its display-name fallback', async () => {
    const fallbackRow: ActivityRow = {
      ...ROWS[0]!,
      sender: { ...ROWS[0]!.sender!, displayName: 'John <john@example.com>' },
    };
    const files = await unzipBundle(
      await makeService(undefined, [fallbackRow]).service.createBundle({
        workspaceId: 'workspace-1',
        mailboxAccountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        filters: FILTERS,
        includeFullSenderAddresses: false,
        includeTechnicalDetails: false,
        generatedAt: GENERATED_AT,
      }),
    );

    expect(files['activity.csv']).toContain('John <j***@example.com>');
    expect(files['activity.csv']).not.toContain('john@example.com');
  });

  it('stops iterating when the download consumer disconnects', async () => {
    let yielded = 0;
    let generatorClosed = false;
    const { service, reads } = makeService();
    vi.mocked(reads.iterateActivity).mockImplementation(async function* () {
      try {
        while (yielded < 10_000) {
          yielded += 1;
          yield ROWS[0]!;
          await Promise.resolve();
        }
      } finally {
        generatorClosed = true;
      }
    });
    const stream = await service.createBundle({
      workspaceId: 'workspace-1',
      mailboxAccountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      filters: FILTERS,
      includeFullSenderAddresses: false,
      includeTechnicalDetails: true,
      generatedAt: GENERATED_AT,
    });

    stream.once('data', () => stream.destroy());
    await new Promise<void>((resolve) => stream.once('close', resolve));
    await vi.waitFor(() => expect(generatorClosed).toBe(true));
    expect(yielded).toBeLessThan(10_000);
  });

  it('rejects a mailbox outside the workspace before reading any Activity', async () => {
    const { service, reads } = makeService([]);
    await expect(
      service.createBundle({
        workspaceId: 'workspace-1',
        mailboxAccountId: 'unowned-mailbox',
        filters: FILTERS,
        includeFullSenderAddresses: false,
        includeTechnicalDetails: false,
        generatedAt: GENERATED_AT,
      }),
    ).rejects.toMatchObject({ code: 'MAILBOX_NOT_OWNED' });
    expect(reads.captureIterationSnapshot).not.toHaveBeenCalled();
  });
});
