import { BadRequestException } from '@nestjs/common';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { IconsService } from '../icons/icons.service.js';
import { ActivityController } from './activity.controller.js';
import type { ActivityReadService } from './activity.read-service.js';
import type { ActivitySupportBundleService } from './activity-support-bundle.service.js';

function makeController() {
  const reads = {
    listActivity: vi.fn(),
  } as unknown as ActivityReadService;
  const bundles = {
    createBundle: vi.fn(() => {
      const stream = new PassThrough();
      stream.end('zip-bytes');
      return Promise.resolve(stream);
    }),
  } as unknown as ActivitySupportBundleService;
  // These specs cover the outcome-filter + export paths, which never touch
  // the icon cache. A stub that returns no marks keeps the avatar
  // decoration out of their way while still satisfying the constructor.
  const icons = {
    marksFor: vi.fn(() => Promise.resolve(new Set<string>())),
  } as unknown as IconsService;
  return { controller: new ActivityController(reads, bundles, icons), bundles, reads };
}

describe('ActivityController outcome filter', () => {
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
