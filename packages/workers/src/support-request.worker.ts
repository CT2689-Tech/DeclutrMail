import { z } from 'zod';
import { SupportRequestSchema } from '@declutrmail/shared/contracts';
import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { EmailDeliveryPort } from './email-send.worker.js';
import { TransientError, ValidationError } from './worker-errors.js';
import type { DeadLetterRecorder } from './dead-letter.recorder.js';
import type { WorkerContext } from './worker-context.js';

export const SupportRequestJobSchema = SupportRequestSchema.extend({
  replyTo: z.string().email().max(320),
  userId: z.string().min(1).max(128),
  workspaceId: z.string().min(1).max(128),
  submittedAt: z.string().datetime(),
  idempotencyKey: z.string().regex(/^support-request__[a-f0-9]{64}$/),
}).strict();
export type SupportRequestJobData = z.infer<typeof SupportRequestJobSchema>;

/** User-initiated support mail, separate from outbound marketing/preferences. */
export class SupportRequestWorker extends BaseDeclutrWorker<
  SupportRequestJobData,
  { providerAccepted: true }
> {
  readonly workerName = 'SupportRequestWorker';
  readonly policy = 'batchPolicy' as const;
  constructor(private readonly delivery: EmailDeliveryPort) {
    super();
  }
  override setDeadLetterRecorder(recorder: DeadLetterRecorder): void {
    super.setDeadLetterRecorder({
      record: (entry) => {
        const parsed = SupportRequestJobSchema.safeParse(entry.payload);
        return recorder.record({
          ...entry,
          payload: parsed.success ? { userId: parsed.data.userId } : {},
        });
      },
    });
  }
  override async processJob(
    input: SupportRequestJobData,
    ctx: WorkerContext,
  ): Promise<{ providerAccepted: true }> {
    const parsed = SupportRequestJobSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError('Invalid support request payload');
    const p = parsed.data;
    ctx.signal?.throwIfAborted();
    let outcome;
    try {
      outcome = await this.delivery.deliver({
        to: 'support@declutrmail.com',
        replyTo: p.replyTo,
        subject: `Support request: ${p.subject}`,
        text: `${p.message}\n\n---\nUser: ${p.replyTo} (${p.userId})\nWorkspace: ${p.workspaceId}`,
        idempotencyKey: p.idempotencyKey,
      });
    } catch {
      // Provider exceptions may contain message content: never persist/log them.
      throw new TransientError('Support delivery transport failed');
    }
    if (!outcome.ok) {
      if (outcome.reason === 'transient')
        throw new TransientError('Support delivery temporarily unavailable');
      throw new ValidationError('Support delivery unavailable');
    }
    return { providerAccepted: true };
  }
}
