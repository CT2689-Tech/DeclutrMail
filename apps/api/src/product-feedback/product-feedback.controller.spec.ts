import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { SessionPrincipal } from '../auth/sessions.service.js';
import { ProductFeedbackController } from './product-feedback.controller.js';
import type { ProductFeedbackService } from './product-feedback.service.js';

const ID = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' } as SessionPrincipal;

describe('ProductFeedbackController', () => {
  it('validates and delegates a bounded request', async () => {
    const submit = vi.fn().mockResolvedValue({
      id: ID,
      surface: 'activity',
      referenceId: ID,
      rating: 'expected',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    const controller = new ProductFeedbackController({
      submit,
    } as unknown as ProductFeedbackService);

    await controller.submit(
      PRINCIPAL,
      { id: 'mailbox-1' },
      {
        surface: 'activity',
        referenceId: ID,
        rating: 'expected',
      },
    );

    expect(submit).toHaveBeenCalledWith(PRINCIPAL, 'mailbox-1', {
      surface: 'activity',
      referenceId: ID,
      rating: 'expected',
    });
  });

  it('rejects cross-surface ratings and additional content', async () => {
    const submit = vi.fn();
    const controller = new ProductFeedbackController({
      submit,
    } as unknown as ProductFeedbackService);

    await expect(
      controller.submit(
        PRINCIPAL,
        { id: 'mailbox-1' },
        {
          surface: 'activity',
          referenceId: ID,
          rating: 'useful',
        },
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      controller.submit(
        PRINCIPAL,
        { id: 'mailbox-1' },
        {
          surface: 'brief',
          referenceId: ID,
          rating: 'useful',
          subject: 'not accepted',
        },
      ),
    ).rejects.toThrow(BadRequestException);
    expect(submit).not.toHaveBeenCalled();
  });
});
