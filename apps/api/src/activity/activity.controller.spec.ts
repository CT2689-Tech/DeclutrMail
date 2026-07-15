import { BadRequestException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { ActivityController } from './activity.controller.js';
import type { ActivityReadService } from './activity.read-service.js';
import type { ActivitySupportBundleService } from './activity-support-bundle.service.js';

function makeController() {
  const reads = {
    listActivity: vi.fn(),
    getWeeklyReview: vi.fn(),
  } as unknown as ActivityReadService;
  const bundles = {
    createBundle: vi.fn(() => {
      const stream = new PassThrough();
      stream.end('zip-bytes');
      return Promise.resolve(stream);
    }),
  } as unknown as ActivitySupportBundleService;
  return { controller: new ActivityController(reads, bundles), bundles, reads };
}

describe('ActivityController weekly review', () => {
  it.each(['unknown', '', 'completed,unknown'])(
    'rejects invalid outcome %j instead of silently broadening',
    async (outcome) => {
      const { controller } = makeController();
      await expect(
        controller.list(
          { userId: 'user-1', workspaceId: 'workspace-1' },
          { id: 'mailbox-1' },
          '7d',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          outcome,
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('forwards only the current mailbox to the weekly aggregate', async () => {
    const { controller, reads } = makeController();
    vi.mocked(reads.getWeeklyReview).mockResolvedValue({
      window: '7d',
      from: '2026-05-18T08:00:00.000Z',
      to: '2026-05-25T08:00:00.000Z',
      completed: 1,
      skipped: 2,
      failed: 3,
      recovered: 4,
      protected: 5,
    });
    await expect(controller.weeklyReview({ id: 'mailbox-1' })).resolves.toMatchObject({
      data: { completed: 1, protected: 5 },
    });
    expect(reads.getWeeklyReview).toHaveBeenCalledWith('mailbox-1', expect.any(Number));
  });
});

describe('ActivityController support bundle', () => {
  it('streams the active-mailbox ZIP with the complete resolved filter set', async () => {
    const { controller, bundles } = makeController();
    const file = await controller.exportBundle(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { id: 'mailbox-1' },
      '90d',
      'autopilot',
      ['archive', 'delete'],
      'sender search',
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
      'full',
      'true',
      'failed,protected',
    );

    expect(bundles.createBundle).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      mailboxAccountId: 'mailbox-1',
      filters: {
        window: '90d',
        source: 'autopilot',
        verbs: ['archive', 'delete'],
        senderQuery: 'sender search',
        dateFrom: new Date('2026-06-01T00:00:00.000Z'),
        dateTo: new Date('2026-07-01T00:00:00.000Z'),
        outcomes: ['failed', 'protected'],
      },
      includeFullSenderAddresses: true,
      includeTechnicalDetails: true,
    });
    expect(file.getHeaders()).toMatchObject({
      type: 'application/zip',
    });
    expect(file.getHeaders().disposition).toMatch(
      /^attachment; filename="declutrmail-activity-support-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
  });

  it('defaults sender addresses to masked and technical details to excluded', async () => {
    const { controller, bundles } = makeController();
    await controller.exportBundle(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { id: 'mailbox-1' },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(bundles.createBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: {
          window: '30d',
          source: null,
          verbs: [],
          senderQuery: '',
          dateFrom: null,
          dateTo: null,
          outcomes: [],
        },
        includeFullSenderAddresses: false,
        includeTechnicalDetails: false,
      }),
    );
  });

  it.each([
    ['bad sender address mode', { senderAddresses: 'raw', technical: undefined }],
    ['bad technical flag', { senderAddresses: undefined, technical: '1' }],
  ])('rejects %s instead of silently widening the export', async (_name, flags) => {
    const { controller } = makeController();
    await expect(
      controller.exportBundle(
        { userId: 'user-1', workspaceId: 'workspace-1' },
        { id: 'mailbox-1' },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        flags.senderAddresses,
        flags.technical,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
