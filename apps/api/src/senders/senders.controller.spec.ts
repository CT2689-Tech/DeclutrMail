import { HttpException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from '@declutrmail/shared/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SendersController } from './senders.controller.js';
import type { SendersReadService } from './senders.read-service.js';
import type {
  DecisionHistoryRow,
  MailMessageRow,
  SenderDetail,
  SenderListRow,
  TimeseriesPoint,
} from './senders.types.js';

/**
 * SendersController unit tests — validate the wire-shape contract +
 * cursor round-trip + tenant 404 behavior (D202).
 *
 * The read service is mocked so the controller's responsibility
 * stays the only thing under test: input validation, cursor
 * encode/decode, envelope shape, HTTP status mapping. The
 * service-level integration tests (senders.read-service.spec.ts) own
 * the SQL behavior.
 */

const MAILBOX_ID = '11111111-1111-1111-1111-111111111111';
const SENDER_ID = '22222222-2222-2222-2222-222222222222';

/** Stand-in for the `@CurrentMailbox()`-resolved value the guard injects. */
const MAILBOX = { id: MAILBOX_ID } as const;

function makeSenderRow(overrides: Partial<SenderListRow> = {}): SenderListRow {
  return {
    id: SENDER_ID,
    displayName: 'Sender Name',
    email: 'sender@example.com',
    domain: 'example.com',
    gmailCategory: 'updates',
    firstSeenAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2026-05-01T00:00:00.000Z',
    monthlyVolume: 10,
    readRate: 0.5,
    volumeTrend: 'steady',
    unsubscribeMethod: 'one_click',
    lastReview: null,
    protectionFlags: {
      isVip: false,
      isProtected: false,
      protectionReason: null,
      protectionSetAt: null,
    },
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<MailMessageRow> = {}): MailMessageRow {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    providerMessageId: 'gmail-msg-1',
    providerThreadId: 'gmail-thread-1',
    subject: 'A subject',
    snippet: 'A snippet (allowlisted by D7)',
    internalDate: '2026-05-01T00:00:00.000Z',
    isUnread: false,
    ...overrides,
  };
}

function makeHistoryRow(overrides: Partial<DecisionHistoryRow> = {}): DecisionHistoryRow {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    verdict: 'archive',
    confidence: 0.85,
    producedAt: '2026-05-01T00:00:00.000Z',
    reasoning: 'High volume, low read rate.',
    generatedBy: 'template',
    ...overrides,
  };
}

interface MockReadService {
  listSenders: ReturnType<typeof vi.fn>;
  getSenderDetail: ReturnType<typeof vi.fn>;
  listMessagesForSender: ReturnType<typeof vi.fn>;
  listTimeseries: ReturnType<typeof vi.fn>;
  listDecisionHistory: ReturnType<typeof vi.fn>;
  listWeeklyHero: ReturnType<typeof vi.fn>;
}

function buildController(): { ctrl: SendersController; reads: MockReadService } {
  // Direct construction bypasses NestJS DI — `swc-node` does not
  // reliably emit `design:paramtypes` metadata that `Test.createTesting
  // Module()` relies on. The undo service spec follows the same
  // pattern (see `undo.service.spec.ts`).
  const reads: MockReadService = {
    listSenders: vi.fn(),
    getSenderDetail: vi.fn(),
    listMessagesForSender: vi.fn(),
    listTimeseries: vi.fn(),
    listDecisionHistory: vi.fn(),
    listWeeklyHero: vi.fn(),
  };
  const ctrl = new SendersController(reads as unknown as SendersReadService);
  return { ctrl, reads };
}

describe('SendersController', () => {
  let ctrl: SendersController;
  let reads: MockReadService;

  beforeEach(() => {
    ({ ctrl, reads } = buildController());
  });

  describe('input validation', () => {
    // Mailbox identity is now resolved by `CurrentMailboxGuard` (D155 +
    // D205) before the controller runs — the controller no longer
    // validates a header. The guard's resolution behaviour is exercised
    // in `current-mailbox.guard.spec.ts`.

    it('throws 400 when the sender id is not a UUID', async () => {
      await expect(ctrl.detail(MAILBOX, 'not-a-uuid')).rejects.toThrow(/UUID/);
    });
  });

  describe('list — envelope + cursor', () => {
    it('returns the D202 paginated envelope with hasMore=false when the service returns ≤ limit rows', async () => {
      reads.listSenders.mockResolvedValue([makeSenderRow()]);
      const res = await ctrl.list(MAILBOX, undefined, '10', undefined);
      expect(res.meta.pagination).toEqual({
        nextCursor: null,
        hasMore: false,
        limit: 10,
      });
      expect(res.data).toHaveLength(1);
    });

    it('emits a nextCursor that round-trips back to a (lastSeenAt, id) boundary', async () => {
      // Service returns limit+1 rows — the controller pops the sentinel
      // and derives the cursor from the LAST returned row (page[limit-1]).
      const rows: SenderListRow[] = [
        makeSenderRow({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          lastSeenAt: '2026-05-03T00:00:00.000Z',
        }),
        makeSenderRow({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          lastSeenAt: '2026-05-02T00:00:00.000Z',
        }),
        makeSenderRow({
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          lastSeenAt: '2026-05-01T00:00:00.000Z',
        }),
      ];
      reads.listSenders.mockResolvedValue(rows);

      const res = await ctrl.list(MAILBOX, undefined, '2', undefined);
      expect(res.data).toHaveLength(2);
      expect(res.meta.pagination.hasMore).toBe(true);
      expect(res.meta.pagination.nextCursor).not.toBeNull();

      const decoded = decodeCursor(res.meta.pagination.nextCursor);
      // Boundary is the LAST returned row (page[1]).
      expect(decoded).toEqual({
        key: '2026-05-02T00:00:00.000Z',
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      });
    });

    it('rejects a malformed cursor with 400', async () => {
      await expect(ctrl.list(MAILBOX, undefined, undefined, 'not-base64!!!')).rejects.toThrow(
        /cursor/i,
      );
    });

    it('forwards a valid cursor to the read service as a Date + id', async () => {
      reads.listSenders.mockResolvedValue([]);
      const cursor = encodeCursor({ key: '2026-05-01T00:00:00.000Z', id: SENDER_ID });
      await ctrl.list(MAILBOX, undefined, undefined, cursor);
      expect(reads.listSenders).toHaveBeenCalledWith(
        expect.objectContaining({
          mailboxAccountId: MAILBOX_ID,
          cursor: {
            lastSeenAt: new Date('2026-05-01T00:00:00.000Z'),
            id: SENDER_ID,
          },
        }),
      );
    });

    it('passes a parsed category to the read service when valid', async () => {
      reads.listSenders.mockResolvedValue([]);
      await ctrl.list(MAILBOX, 'promotions', undefined, undefined);
      expect(reads.listSenders).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'promotions' }),
      );
    });

    it('silently drops an unknown category value', async () => {
      reads.listSenders.mockResolvedValue([]);
      await ctrl.list(MAILBOX, 'not-real', undefined, undefined);
      expect(reads.listSenders).toHaveBeenCalledWith(expect.objectContaining({ category: null }));
    });

    it('clamps an over-max ?limit= to 100', async () => {
      reads.listSenders.mockResolvedValue([]);
      await ctrl.list(MAILBOX, undefined, '999999', undefined);
      expect(reads.listSenders).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });
  });

  describe('detail', () => {
    it('returns the envelope when the read service finds the sender', async () => {
      const detail: SenderDetail = {
        ...makeSenderRow(),
        protectionFlags: {
          isVip: false,
          isProtected: false,
          protectionReason: null,
          protectionSetAt: null,
        },
      };
      reads.getSenderDetail.mockResolvedValue(detail);
      const res = await ctrl.detail(MAILBOX, SENDER_ID);
      expect(res.data).toEqual(detail);
    });

    it('returns 404 when the read service returns null (cross-mailbox or missing)', async () => {
      reads.getSenderDetail.mockResolvedValue(null);
      await expect(ctrl.detail(MAILBOX, SENDER_ID)).rejects.toMatchObject({
        getStatus: expect.any(Function),
      });
      try {
        await ctrl.detail(MAILBOX, SENDER_ID);
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });
  });

  describe('messages', () => {
    it('returns 404 when the sender is not in this mailbox', async () => {
      reads.listMessagesForSender.mockResolvedValue(null);
      try {
        await ctrl.messages(MAILBOX, SENDER_ID, undefined, undefined);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('honors the D46 default limit of 10', async () => {
      reads.listMessagesForSender.mockResolvedValue([]);
      await ctrl.messages(MAILBOX, SENDER_ID, undefined, undefined);
      expect(reads.listMessagesForSender).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('clamps the limit to 50', async () => {
      reads.listMessagesForSender.mockResolvedValue([]);
      await ctrl.messages(MAILBOX, SENDER_ID, '500', undefined);
      expect(reads.listMessagesForSender).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('returns the envelope with the messages page', async () => {
      reads.listMessagesForSender.mockResolvedValue([makeMessageRow()]);
      const res = await ctrl.messages(MAILBOX, SENDER_ID, undefined, undefined);
      expect(res.data).toHaveLength(1);
      expect(res.meta.pagination.hasMore).toBe(false);
    });

    it('emits a nextCursor keyed by internalDate when more pages exist', async () => {
      const rows: MailMessageRow[] = [
        makeMessageRow({
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          internalDate: '2026-05-03T00:00:00.000Z',
        }),
        makeMessageRow({
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          internalDate: '2026-05-02T00:00:00.000Z',
        }),
      ];
      reads.listMessagesForSender.mockResolvedValue(rows);
      const res = await ctrl.messages(MAILBOX, SENDER_ID, '1', undefined);
      expect(res.meta.pagination.hasMore).toBe(true);
      const decoded = decodeCursor(res.meta.pagination.nextCursor);
      expect(decoded).toEqual({
        key: '2026-05-03T00:00:00.000Z',
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
    });
  });

  describe('timeseries', () => {
    it('returns 404 when the sender is not in this mailbox', async () => {
      reads.listTimeseries.mockResolvedValue(null);
      try {
        await ctrl.timeseries(MAILBOX, SENDER_ID);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('wraps the points array in the simple envelope (no pagination meta)', async () => {
      const points: TimeseriesPoint[] = [{ yearMonth: '2026-05', volume: 10, readCount: 3 }];
      reads.listTimeseries.mockResolvedValue(points);
      const res = await ctrl.timeseries(MAILBOX, SENDER_ID);
      expect(res).toEqual({ data: points });
    });
  });

  describe('history', () => {
    it('returns 404 when the sender is not in this mailbox', async () => {
      reads.listDecisionHistory.mockResolvedValue(null);
      try {
        await ctrl.history(MAILBOX, SENDER_ID, undefined, undefined);
        throw new Error('expected throw');
      } catch (e) {
        expect((e as HttpException).getStatus()).toBe(404);
      }
    });

    it('honors the D46 default limit of 10', async () => {
      reads.listDecisionHistory.mockResolvedValue([]);
      await ctrl.history(MAILBOX, SENDER_ID, undefined, undefined);
      expect(reads.listDecisionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10 }),
      );
    });

    it('clamps the limit to 50', async () => {
      reads.listDecisionHistory.mockResolvedValue([]);
      await ctrl.history(MAILBOX, SENDER_ID, '500', undefined);
      expect(reads.listDecisionHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 }),
      );
    });

    it('returns the envelope with the history page', async () => {
      reads.listDecisionHistory.mockResolvedValue([makeHistoryRow()]);
      const res = await ctrl.history(MAILBOX, SENDER_ID, undefined, undefined);
      expect(res.data).toHaveLength(1);
      expect(res.data[0]!.verdict).toBe('archive');
    });
  });

  /**
   * Weekly Hero (D47, D48) — controller-level contract. The service
   * unit-test covers slice computation; here we only verify header
   * validation, the envelope shape, and the route precedence comment
   * (the literal `weekly-hero` path must NOT fall into the `:id` UUID
   * 400 path).
   */
  describe('weeklyHero', () => {
    // The mailbox-header test was retired with the JwtGuard +
    // CurrentMailboxGuard split (D155 + D205) — mailbox identity is
    // resolved by the guard, not validated in the controller.

    it('returns the envelope with isMonday + weekOf + slices', async () => {
      reads.listWeeklyHero.mockResolvedValue({
        isMonday: true,
        weekOf: '2026-05-11',
        slices: [
          {
            kind: 'high_confidence',
            totalCount: 3,
            senders: [
              {
                id: SENDER_ID,
                displayName: 'X',
                email: 'x@example.com',
                domain: 'example.com',
                monthlyVolume: 12,
                readRate: 0,
                sparkline: new Array<number>(12).fill(0),
              },
            ],
          },
        ],
      });
      const res = await ctrl.weeklyHero(MAILBOX);
      expect(res.data.isMonday).toBe(true);
      expect(res.data.weekOf).toBe('2026-05-11');
      expect(res.data.slices).toHaveLength(1);
      expect(res.data.slices[0]!.kind).toBe('high_confidence');
    });
  });
});
