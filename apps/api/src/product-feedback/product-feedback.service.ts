import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { activityLog, briefRuns, followupTracker, productFeedback } from '@declutrmail/db';
import type { ProductFeedbackRequest, ProductFeedbackResult } from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';

interface FeedbackPrincipal {
  userId: string;
  workspaceId: string;
}

@Injectable()
export class ProductFeedbackService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async submit(
    principal: FeedbackPrincipal,
    mailboxAccountId: string,
    request: ProductFeedbackRequest,
  ): Promise<ProductFeedbackResult> {
    await this.assertOwnedReference(mailboxAccountId, request);

    const target =
      request.surface === 'activity'
        ? { activityLogId: request.referenceId, briefRunId: null, followupTrackerId: null }
        : request.surface === 'brief'
          ? { activityLogId: null, briefRunId: request.referenceId, followupTrackerId: null }
          : { activityLogId: null, briefRunId: null, followupTrackerId: request.referenceId };

    const insert = this.db.insert(productFeedback).values({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      mailboxAccountId,
      surface: request.surface,
      rating: request.rating,
      ...target,
    });

    const conflict =
      request.surface === 'activity'
        ? insert.onConflictDoUpdate({
            target: [productFeedback.userId, productFeedback.activityLogId],
            targetWhere: eq(productFeedback.surface, 'activity'),
            set: { rating: request.rating, updatedAt: new Date() },
          })
        : request.surface === 'brief'
          ? insert.onConflictDoUpdate({
              target: [productFeedback.userId, productFeedback.briefRunId],
              targetWhere: eq(productFeedback.surface, 'brief'),
              set: { rating: request.rating, updatedAt: new Date() },
            })
          : insert.onConflictDoUpdate({
              target: [productFeedback.userId, productFeedback.followupTrackerId],
              targetWhere: eq(productFeedback.surface, 'followups'),
              set: { rating: request.rating, updatedAt: new Date() },
            });

    const [saved] = await conflict.returning();
    if (!saved) throw new Error('Product feedback upsert returned no row.');

    return {
      id: saved.id,
      surface: saved.surface,
      referenceId: request.referenceId,
      rating: saved.rating,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  private async assertOwnedReference(
    mailboxAccountId: string,
    request: ProductFeedbackRequest,
  ): Promise<void> {
    const found =
      request.surface === 'activity'
        ? await this.db
            .select({ id: activityLog.id })
            .from(activityLog)
            .where(
              and(
                eq(activityLog.id, request.referenceId),
                eq(activityLog.mailboxAccountId, mailboxAccountId),
                eq(activityLog.source, 'autopilot'),
              ),
            )
            .limit(1)
        : request.surface === 'brief'
          ? await this.db
              .select({ id: briefRuns.id })
              .from(briefRuns)
              .where(
                and(
                  eq(briefRuns.id, request.referenceId),
                  eq(briefRuns.mailboxAccountId, mailboxAccountId),
                ),
              )
              .limit(1)
          : await this.db
              .select({ id: followupTracker.id })
              .from(followupTracker)
              .where(
                and(
                  eq(followupTracker.id, request.referenceId),
                  eq(followupTracker.mailboxAccountId, mailboxAccountId),
                ),
              )
              .limit(1);

    if (!found[0]) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Feedback target not found.',
      });
    }
  }
}
