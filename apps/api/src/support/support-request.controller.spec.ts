import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../common/app-exception.js';
import type { SessionPrincipal } from '../auth/sessions.service.js';
import { SupportRequestController } from './support-request.controller.js';
import type { SupportRequestService } from './support-request.service.js';

const PRINCIPAL = { userId: 'user-1', workspaceId: 'workspace-1' } as SessionPrincipal;

describe('SupportRequestController', () => {
  it('validates and delegates a bounded request', async () => {
    const submit = vi.fn().mockResolvedValue({ submittedAt: '2026-09-01T00:00:00.000Z' });
    const controller = new SupportRequestController({
      submit,
    } as unknown as SupportRequestService);

    const result = await controller.submit(PRINCIPAL, {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    });

    expect(submit).toHaveBeenCalledWith(PRINCIPAL, {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    });
    expect(result).toEqual({ data: { submittedAt: '2026-09-01T00:00:00.000Z' } });
  });

  it('rejects a too-short message and an unknown field without calling the service', async () => {
    const submit = vi.fn();
    const controller = new SupportRequestController({
      submit,
    } as unknown as SupportRequestService);

    await expect(
      controller.submit(PRINCIPAL, { subject: 'Hi', message: 'too short' }),
    ).rejects.toThrow(AppException);
    await expect(
      controller.submit(PRINCIPAL, {
        subject: 'Hi',
        message: 'A message that is long enough to pass.',
        category: 'billing',
      }),
    ).rejects.toThrow(AppException);
    expect(submit).not.toHaveBeenCalled();
  });
});
