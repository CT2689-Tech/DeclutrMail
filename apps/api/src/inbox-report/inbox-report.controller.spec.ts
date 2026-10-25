import { describe, expect, it, vi } from 'vitest';
import type { InboxReportService } from './inbox-report.service.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';

import { RATE_LIMIT_METADATA } from '../common/rate-limit/rate-limit.types.js';
import { InboxReportController } from './inbox-report.controller.js';

describe('InboxReportController', () => {
  it('checks snapshot ownership before the read, returns its envelope, and rate limits it', async () => {
    const result = {
      asOf: '2026-10-25T20:00:00Z',
      inboxCount: 60,
      unreadInboxCount: 40,
      receivedCount: 62,
      totalBytes: null,
      sizeKnownCount: 0,
    };
    const calls: string[] = [];
    const service = {
      assertInWorkspace: vi.fn(async (workspaceId: string, id: string) => {
        calls.push(`${workspaceId}:${id}`);
      }),
      getSnapshot: vi.fn(async () => {
        calls.push('read');
        return result;
      }),
    };
    const controller = new InboxReportController(service as unknown as InboxReportService);
    expect(
      await controller.snapshot({ workspaceId: 'workspace-a' } as SessionPrincipal, 'mailbox-a'),
    ).toEqual({ data: result });
    expect(calls).toEqual(['workspace-a:mailbox-a', 'read']);
    expect(
      Reflect.getMetadata(RATE_LIMIT_METADATA, InboxReportController.prototype.snapshot),
    ).toEqual({ bucket: 'triage-load' });
    service.assertInWorkspace.mockRejectedValueOnce(new Error('unowned'));
    await expect(
      controller.snapshot({ workspaceId: 'workspace-b' } as SessionPrincipal, 'mailbox-a'),
    ).rejects.toThrow('unowned');
    expect(service.getSnapshot).toHaveBeenCalledTimes(1);
  });
  it('rate-limits the report read on the triage-load bucket', () => {
    expect(Reflect.getMetadata(RATE_LIMIT_METADATA, InboxReportController.prototype.get)).toEqual({
      bucket: 'triage-load',
    });
  });
});
