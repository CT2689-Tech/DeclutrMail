import { and, asc, eq, lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { actionJobs, actionRecoveryPreviews, mailMessages } from '@declutrmail/db';
import type { ActionRecoveryOutcome, schema } from '@declutrmail/db';

import { BaseDeclutrWorker } from './base-declutr-worker.js';
import type { GmailAccess } from './ports.js';
import { InvalidGrantError, PermanentError, ValidationError } from './worker-errors.js';
import type { WorkerContext } from './worker-context.js';

/** One metadata-only verification of a durable Activity recovery preview. */
export interface ActionRecoveryJobData {
  previewId: string;
  mailboxAccountId: string;
  actionId: string;
}

/** Metric-only verification result. */
export interface ActionRecoveryResult {
  previewId: string;
  outcome: ActionRecoveryOutcome;
  targetCount: number;
  remainingCount: number;
  verifiedCount: number;
  unavailableCount: number;
  alreadyDone: boolean;
}

type WorkerDb = PostgresJsDatabase<typeof schema>;
type RecoverableVerb = 'archive' | 'later' | 'delete';

export interface ActionRecoveryDeps {
  db: WorkerDb;
  /** Metadata-only messages.get access; this worker never mutates Gmail. */
  gmail: GmailAccess;
  now?: () => Date;
}

/**
 * Builds a fresh provider-state preview for a failed label action.
 *
 * The worker is intentionally read-only at the provider boundary. It freezes
 * an exact target set, reads each target with metadata-only messages.get, and
 * records which messages do not yet have the intended label state. A later
 * confirmation creates a new linked action attempt; this worker never does.
 */
export class ActionRecoveryWorker extends BaseDeclutrWorker<
  ActionRecoveryJobData,
  ActionRecoveryResult
> {
  readonly workerName = 'ActionRecoveryWorker';
  readonly policy = 'perMailboxPolicy' as const;

  constructor(private readonly deps: ActionRecoveryDeps) {
    super();
  }

  protected override getIdempotencyKey(payload: ActionRecoveryJobData): string {
    return payload.previewId;
  }

  override async processJob(
    payload: ActionRecoveryJobData,
    _ctx: WorkerContext,
  ): Promise<ActionRecoveryResult> {
    const preview = await this.loadPreview(payload);
    if (preview.status !== 'verifying') {
      return resultFromPreview(preview, true);
    }

    try {
      const action = await this.loadRecoverableAction(payload, preview.rootActionId);
      const targetIds = await this.freezeTarget(preview, action);

      if (targetIds.length === 0) {
        return this.completeEmptyPreview(payload.previewId);
      }

      // A deterministic original failure cannot be made safe by reissuing
      // the same action. Classify it before touching the provider.
      if (action.errorCode === 'PermanentError' || action.errorCode === 'ValidationError') {
        return this.completeFailedPreview(
          payload.previewId,
          targetIds.length,
          'blocked',
          action.errorCode,
        );
      }

      const metadata = await this.deps.gmail.getClient(payload.mailboxAccountId);
      if (!metadata.getMessageLabelIds) {
        throw new ValidationError('Gmail metadata client does not support label-only lookup');
      }
      let laterLabelId: string | null = null;
      if (action.verb === 'later') {
        if (!metadata.findLabelId) {
          throw new ValidationError(
            'Gmail metadata client does not support read-only label lookup',
          );
        }
        laterLabelId = await metadata.findLabelId('DeclutrMail/Later');
      }

      const remainingIds: string[] = [];
      const availableIds: string[] = [];
      for (const messageId of targetIds) {
        const labelIds = await metadata.getMessageLabelIds(messageId);
        if (labelIds === null) continue;
        availableIds.push(messageId);
        if (!hasIntendedState(action.verb, labelIds, laterLabelId)) {
          remainingIds.push(messageId);
        }
      }

      const unavailableCount = targetIds.length - availableIds.length;
      if (availableIds.length === 0) {
        return this.completeEmptyPreview(payload.previewId, unavailableCount);
      }

      const outcome = classifyOutcome(availableIds.length, remainingIds.length);
      const verifiedAt = (this.deps.now ?? (() => new Date()))();
      const [completed] = await this.deps.db
        .update(actionRecoveryPreviews)
        .set({
          status: 'ready',
          outcome,
          // Confirmation may only reapply provider-existing ids. Keeping a
          // missing id here could make the whole Gmail batch mutation fail.
          targetMessageIds: availableIds,
          remainingMessageIds: remainingIds,
          verifiedCount: availableIds.length,
          unavailableCount,
          errorCode: null,
          verifiedAt,
          updatedAt: verifiedAt,
        })
        .where(
          and(
            eq(actionRecoveryPreviews.id, payload.previewId),
            eq(actionRecoveryPreviews.mailboxAccountId, payload.mailboxAccountId),
            eq(actionRecoveryPreviews.status, 'verifying'),
          ),
        )
        .returning();

      if (completed) return resultFromPreview(completed, false);
      return resultFromPreview(await this.loadPreview(payload), true);
    } catch (error) {
      if (error instanceof InvalidGrantError) {
        return this.completeFailedPreview(
          payload.previewId,
          preview.targetMessageIds.length,
          'reconnect_required',
          'GMAIL_RECONNECT_REQUIRED',
        );
      }
      if (error instanceof PermanentError || error instanceof ValidationError) {
        return this.completeFailedPreview(
          payload.previewId,
          preview.targetMessageIds.length,
          'blocked',
          error.name,
        );
      }
      // Transient/rate-limit/auth-expired failures use the normal queue
      // budget. `onTerminalFailure` records `uncertain` only after the final
      // attempt, so a temporary read outage does not prematurely close the
      // user's preview.
      throw error;
    }
  }

  protected override async onTerminalFailure(
    payload: ActionRecoveryJobData,
    error: Error,
  ): Promise<void> {
    try {
      const verifiedAt = (this.deps.now ?? (() => new Date()))();
      await this.deps.db
        .update(actionRecoveryPreviews)
        .set({
          status: 'failed',
          outcome: 'uncertain',
          errorCode: error.name,
          verifiedAt,
          updatedAt: verifiedAt,
        })
        .where(
          and(
            eq(actionRecoveryPreviews.id, payload.previewId),
            eq(actionRecoveryPreviews.mailboxAccountId, payload.mailboxAccountId),
            eq(actionRecoveryPreviews.status, 'verifying'),
          ),
        );
    } catch (recordError) {
      console.error(
        JSON.stringify({
          level: 'error',
          kind: 'action_recovery.failed_status_write_failed',
          previewId: payload.previewId,
          message: recordError instanceof Error ? recordError.message : String(recordError),
        }),
      );
    }
  }

  private async loadPreview(payload: ActionRecoveryJobData) {
    const [preview] = await this.deps.db
      .select()
      .from(actionRecoveryPreviews)
      .where(
        and(
          eq(actionRecoveryPreviews.id, payload.previewId),
          eq(actionRecoveryPreviews.mailboxAccountId, payload.mailboxAccountId),
          eq(actionRecoveryPreviews.currentActionId, payload.actionId),
        ),
      )
      .limit(1);
    if (!preview) {
      throw new ValidationError(`recovery preview ${payload.previewId} not found`);
    }
    return preview;
  }

  private async loadRecoverableAction(
    payload: ActionRecoveryJobData,
    expectedRootActionId: string,
  ) {
    const [action] = await this.deps.db
      .select()
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.id, payload.actionId),
          eq(actionJobs.mailboxAccountId, payload.mailboxAccountId),
        ),
      )
      .limit(1);
    if (!action) throw new ValidationError(`action ${payload.actionId} not found`);
    const rootActionId = action.rootActionId ?? action.id;
    if (rootActionId !== expectedRootActionId) {
      throw new ValidationError('recovery preview lineage does not match its current action');
    }
    if (action.direction !== 'forward' || action.status !== 'failed') {
      throw new ValidationError('Activity recovery requires a failed forward action');
    }
    if (!isRecoverableVerb(action.verb)) {
      throw new ValidationError(`action verb ${action.verb} does not support Activity recovery`);
    }
    return { ...action, verb: action.verb as RecoverableVerb };
  }

  /** Freeze once; a provider-read retry reuses the same exact target ids. */
  private async freezeTarget(
    preview: typeof actionRecoveryPreviews.$inferSelect,
    action: typeof actionJobs.$inferSelect & { verb: RecoverableVerb },
  ): Promise<string[]> {
    if (preview.targetMessageIds.length > 0) return preview.targetMessageIds;

    let candidate: string[];
    if (
      action.resolvedMessageIds.length > 0 ||
      action.selectionFrozenAt !== null ||
      action.selector.type === 'messages'
    ) {
      candidate = action.resolvedMessageIds;
    } else {
      candidate = await this.resolveCurrentSenderInbox(action);
    }
    candidate = [...new Set(candidate)].sort();
    if (candidate.length === 0) return [];

    const [frozen] = await this.deps.db
      .update(actionRecoveryPreviews)
      .set({ targetMessageIds: candidate, updatedAt: (this.deps.now ?? (() => new Date()))() })
      .where(
        and(
          eq(actionRecoveryPreviews.id, preview.id),
          eq(actionRecoveryPreviews.status, 'verifying'),
          sql`cardinality(${actionRecoveryPreviews.targetMessageIds}) = 0`,
        ),
      )
      .returning({ targetMessageIds: actionRecoveryPreviews.targetMessageIds });
    if (frozen) return frozen.targetMessageIds;

    const [current] = await this.deps.db
      .select({ targetMessageIds: actionRecoveryPreviews.targetMessageIds })
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, preview.id))
      .limit(1);
    if (!current) throw new ValidationError(`recovery preview ${preview.id} disappeared`);
    return current.targetMessageIds;
  }

  private async resolveCurrentSenderInbox(
    action: typeof actionJobs.$inferSelect & { verb: RecoverableVerb },
  ): Promise<string[]> {
    if (action.selector.type !== 'sender') return action.resolvedMessageIds;
    const predicates = [
      eq(mailMessages.mailboxAccountId, action.mailboxAccountId),
      eq(mailMessages.senderKey, action.selector.senderKey),
      sql`'INBOX' = ANY(${mailMessages.labelIds})`,
    ];
    if (action.olderThanDays !== null) {
      const now = (this.deps.now ?? (() => new Date()))();
      const cutoff = new Date(now.getTime() - action.olderThanDays * 24 * 60 * 60 * 1000);
      predicates.push(lte(mailMessages.internalDate, cutoff));
    }
    const rows = await this.deps.db
      .select({ providerMessageId: mailMessages.providerMessageId })
      .from(mailMessages)
      .where(and(...predicates))
      .orderBy(asc(mailMessages.providerMessageId));
    return rows.map((row) => row.providerMessageId);
  }

  private async completeEmptyPreview(
    previewId: string,
    unavailableCount = 0,
  ): Promise<ActionRecoveryResult> {
    const now = (this.deps.now ?? (() => new Date()))();
    const [completed] = await this.deps.db
      .update(actionRecoveryPreviews)
      .set({
        status: 'consumed',
        outcome: 'no_change_needed',
        targetMessageIds: [],
        remainingMessageIds: [],
        verifiedCount: 0,
        unavailableCount,
        errorCode: null,
        verifiedAt: now,
        consumedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(actionRecoveryPreviews.id, previewId),
          eq(actionRecoveryPreviews.status, 'verifying'),
        ),
      )
      .returning();
    if (completed) return resultFromPreview(completed, false);
    const [current] = await this.deps.db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, previewId))
      .limit(1);
    if (!current) throw new ValidationError(`recovery preview ${previewId} disappeared`);
    return resultFromPreview(current, true);
  }

  private async completeFailedPreview(
    previewId: string,
    targetCount: number,
    outcome: 'reconnect_required' | 'blocked',
    errorCode: string,
  ): Promise<ActionRecoveryResult> {
    const now = (this.deps.now ?? (() => new Date()))();
    const [completed] = await this.deps.db
      .update(actionRecoveryPreviews)
      .set({
        status: 'failed',
        outcome,
        errorCode,
        verifiedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(actionRecoveryPreviews.id, previewId),
          eq(actionRecoveryPreviews.status, 'verifying'),
        ),
      )
      .returning();
    if (completed) return resultFromPreview(completed, false);
    const [current] = await this.deps.db
      .select()
      .from(actionRecoveryPreviews)
      .where(eq(actionRecoveryPreviews.id, previewId))
      .limit(1);
    if (!current) throw new ValidationError(`recovery preview ${previewId} disappeared`);
    // The argument protects metric accuracy if a concurrent completion is
    // not visible through a stale driver result; normal paths use the row.
    return { ...resultFromPreview(current, true), targetCount };
  }
}

function isRecoverableVerb(verb: string): verb is RecoverableVerb {
  return verb === 'archive' || verb === 'later' || verb === 'delete';
}

function hasIntendedState(
  verb: RecoverableVerb,
  labelIds: string[],
  laterLabelId: string | null,
): boolean {
  if (verb === 'archive') return !labelIds.includes('INBOX');
  if (verb === 'delete') {
    return labelIds.includes('TRASH') && !labelIds.includes('INBOX');
  }
  return laterLabelId !== null && labelIds.includes(laterLabelId) && !labelIds.includes('INBOX');
}

function classifyOutcome(targetCount: number, remainingCount: number): ActionRecoveryOutcome {
  if (targetCount === 0) return 'no_change_needed';
  if (remainingCount === targetCount) return 'not_applied';
  if (remainingCount === 0) return 'already_applied';
  return 'partial';
}

function resultFromPreview(
  preview: typeof actionRecoveryPreviews.$inferSelect,
  alreadyDone: boolean,
): ActionRecoveryResult {
  return {
    previewId: preview.id,
    outcome: preview.outcome ?? 'uncertain',
    targetCount: preview.targetMessageIds.length,
    remainingCount: preview.remainingMessageIds.length,
    verifiedCount: preview.verifiedCount,
    unavailableCount: preview.unavailableCount,
    alreadyDone,
  };
}
