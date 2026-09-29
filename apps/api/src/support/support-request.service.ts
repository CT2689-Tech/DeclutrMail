import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  SUPPORT_REQUEST_QUEUE,
  SupportRequestJobSchema,
  supportRequestJobOptions,
  type SupportRequestJobData,
} from '@declutrmail/workers';
import {
  SupportRequestSchema,
  type SupportRequestPayload,
  type SupportRequestResult,
} from '@declutrmail/shared/contracts';
import { AppException } from '../common/app-exception.js';
import { UsersService } from '../users/users.service.js';

export const SUPPORT_QUEUE_TOKEN = Symbol('SUPPORT_QUEUE');
interface SupportPrincipal {
  userId: string;
  workspaceId: string;
}

@Injectable()
export class SupportRequestService {
  constructor(
    private readonly users: UsersService,
    @Inject(SUPPORT_QUEUE_TOKEN) private readonly queue: Queue<SupportRequestJobData> | null,
  ) {}

  async submit(
    principal: SupportPrincipal,
    input: SupportRequestPayload,
  ): Promise<SupportRequestResult> {
    const parsed = SupportRequestSchema.safeParse(input);
    if (!parsed.success) throw new AppException({ code: 'BAD_REQUEST' });
    if (!this.queue) throw new AppException({ code: 'SERVICE_UNAVAILABLE' });
    const payload = parsed.data;
    const user = await this.users.findById(principal.userId);
    const submittedAt = new Date().toISOString();
    const idempotencyKey = `support-request__${createHash('sha256')
      .update(
        JSON.stringify([
          principal.userId,
          principal.workspaceId,
          user?.email,
          payload.subject,
          payload.message,
        ]),
      )
      .digest('hex')}`;
    const job = SupportRequestJobSchema.safeParse({
      ...payload,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      replyTo: user?.email,
      submittedAt,
      idempotencyKey,
    });
    if (!job.success) throw new AppException({ code: 'SERVICE_UNAVAILABLE' });
    try {
      const queued = await this.queue.add(
        SUPPORT_REQUEST_QUEUE,
        job.data,
        supportRequestJobOptions(idempotencyKey),
      );
      if ((await queued.getState()) === 'failed')
        throw new Error('Support delivery previously failed');
    } catch {
      throw new AppException({ code: 'SERVICE_UNAVAILABLE' });
    }
    return { status: 'accepted', submittedAt };
  }
}
