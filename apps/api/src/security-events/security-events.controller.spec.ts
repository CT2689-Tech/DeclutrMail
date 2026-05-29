import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decodeCursor, encodeCursor } from '@declutrmail/shared/contracts';

import type {
  SecurityEventRow,
  SecurityEventsReadService,
} from './security-events-read.service.js';
import { SecurityEventsController } from './security-events.controller.js';

/**
 * SecurityEventsController tests (D181 read surface).
 *
 * Covers:
 *   - D202 paginated-envelope shape (`{data, meta.pagination}`)
 *   - severity validation (closed enum at controller boundary)
 *   - from/to ISO-8601 validation
 *   - cursor round-trip (encode boundary → decode → reads from
 *     boundary on next page)
 *   - limit clamp ([1, 200], default 50)
 *
 * The guard chain (JwtGuard + AdminAllowlistGuard) is tested separately
 * in `admin-allowlist.guard.spec.ts`; this spec exercises the
 * controller's own logic by direct instantiation.
 */

function makeRow(overrides: Partial<SecurityEventRow> = {}): SecurityEventRow {
  return {
    id: 'evt-1',
    eventType: 'login.failure',
    severity: 'warning',
    occurredAt: new Date('2026-05-29T20:00:00Z'),
    workspaceId: null,
    userId: null,
    sourceIp: '203.0.113.1',
    userAgent: 'curl/8',
    payload: { reason: 'missing_state_cookie' },
    ...overrides,
  };
}

describe('SecurityEventsController (D181 read surface)', () => {
  let reads: { list: ReturnType<typeof vi.fn> };
  let controller: SecurityEventsController;

  beforeEach(() => {
    reads = { list: vi.fn() };
    controller = new SecurityEventsController(reads as unknown as SecurityEventsReadService);
  });

  describe('envelope', () => {
    it('wraps the rows in the D202 paginated envelope', async () => {
      reads.list.mockResolvedValueOnce([makeRow()]);
      const res = await controller.list();
      expect(res).toEqual({
        data: [makeRow()],
        meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
      });
    });

    it('emits nextCursor only when the page fills the limit', async () => {
      // limit=2, page returned 2 rows → cursor encoded from last row
      reads.list.mockResolvedValueOnce([
        makeRow({ id: 'a', occurredAt: new Date('2026-05-29T20:00:00Z') }),
        makeRow({ id: 'b', occurredAt: new Date('2026-05-29T19:00:00Z') }),
      ]);
      const res = await controller.list(undefined, undefined, undefined, undefined, undefined, '2');
      expect(res.meta.pagination.hasMore).toBe(true);
      const decoded = decodeCursor(res.meta.pagination.nextCursor);
      expect(decoded).toEqual({ key: '2026-05-29T19:00:00.000Z', id: 'b' });
    });

    it('emits nextCursor=null when the page is short (last page)', async () => {
      reads.list.mockResolvedValueOnce([makeRow()]);
      const res = await controller.list(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '50',
      );
      expect(res.meta.pagination.nextCursor).toBeNull();
      expect(res.meta.pagination.hasMore).toBe(false);
    });
  });

  describe('limit clamp', () => {
    it('defaults to 50 when limit is unset', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list();
      expect(reads.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });

    it('clamps to [1, 200]', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, undefined, undefined, undefined, '5000');
      expect(reads.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, undefined, undefined, undefined, '0');
      expect(reads.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('falls back to default for non-numeric input', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, undefined, undefined, undefined, 'abc');
      expect(reads.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
    });
  });

  describe('severity validation', () => {
    it('passes through info/warning/critical', async () => {
      reads.list.mockResolvedValue([]);
      for (const sev of ['info', 'warning', 'critical'] as const) {
        await controller.list(sev);
        expect(reads.list).toHaveBeenLastCalledWith(expect.objectContaining({ severity: sev }));
      }
    });

    it('400s on an unknown severity (no silent empty result)', async () => {
      await expect(controller.list('bogus')).rejects.toBeInstanceOf(BadRequestException);
      expect(reads.list).not.toHaveBeenCalled();
    });
  });

  describe('from / to bounds', () => {
    it('passes valid ISO timestamps through as Date', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, '2026-05-01T00:00:00Z', '2026-05-31T23:59:59Z');
      const call = reads.list.mock.calls[0]?.[0] as { from?: Date; to?: Date };
      expect(call.from?.toISOString()).toBe('2026-05-01T00:00:00.000Z');
      expect(call.to?.toISOString()).toBe('2026-05-31T23:59:59.000Z');
    });

    it('400s on a malformed from / to (typo points at typo, not empty result)', async () => {
      await expect(controller.list(undefined, undefined, 'last-tuesday')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        controller.list(undefined, undefined, undefined, '2026-13-01'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('event_type filter', () => {
    it('passes through as an exact-match filter', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, 'login.failure');
      expect(reads.list).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'login.failure' }),
      );
    });
  });

  describe('cursor round-trip', () => {
    it('decodes the inbound cursor and forwards to the read service', async () => {
      const cursor = encodeCursor({ key: '2026-05-29T18:00:00.000Z', id: 'evt-X' });
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, undefined, undefined, cursor);
      const call = reads.list.mock.calls[0]?.[0] as {
        cursor: { key: string; id: string } | null;
      };
      expect(call.cursor).toEqual({ key: '2026-05-29T18:00:00.000Z', id: 'evt-X' });
    });

    it('treats a garbled cursor as a fresh first page (cursor → null)', async () => {
      reads.list.mockResolvedValueOnce([]);
      await controller.list(undefined, undefined, undefined, undefined, 'not-base64!@#');
      expect(reads.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: null }));
    });
  });
});
