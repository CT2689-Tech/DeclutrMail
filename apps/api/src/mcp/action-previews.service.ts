import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import {
  actionPreviews,
  mailboxAccounts,
  oauthClients,
  oauthGrants,
  senderPolicies,
  senders,
  type ActionJobStatus,
  type ActionPreview,
  type ActionPreviewResult,
  type ActionPreviewSkipReason,
  type ActionPreviewVerb,
} from '@declutrmail/db';
import { unsubscribeCapabilityOf } from '@declutrmail/shared/actions';
import { gmailComposeUrlFromMailto } from '@declutrmail/shared/contracts';
import { createLimiter } from '@declutrmail/workers';

import { ActionsService } from '../actions/actions.service.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { exceptionCode, McpToolError } from './mcp-tool-errors.js';

/** How long a person has to confirm (spec §3). */
export const PREVIEW_TTL_MS = 15 * 60 * 1000;
/** Senders named on the confirm page before "and N more". */
const NAMED_SENDERS = 5;
/** Keep writes one decision per sender; this many at a time. */
const KEEP_CONCURRENCY = 8;

export interface PreviewSkip {
  senderId: string;
  reason: ActionPreviewSkipReason;
}

/** Who is asking: the person and the connected app acting for them. */
export interface PreviewOwner {
  userId: string;
  workspaceId: string;
  grantId: string;
}

/** A preview as its owner may see it, with what only a join can tell. */
export interface PreviewDetail {
  preview: ActionPreview;
  mailboxEmail: string;
  /** The connected app's name; null when it registered without one. */
  appName: string | null;
  /** True once the 15 minutes are up and nothing was confirmed. */
  expired: boolean;
}

/** One skipped sender, with what a person needs to act on it. */
export interface DescribedSkip extends PreviewSkip {
  name: string | null;
  /** `mailto` only: the Gmail compose link the person sends themself. */
  composeUrl: string | null;
}

interface SenderFacts {
  id: string;
  senderKey: string;
  name: string;
  isProtected: boolean;
  unsubscribe: 'one_click' | 'mailto' | 'none' | 'unknown';
  mailtoUrl: string | null;
}

const WINDOW_KEY = {
  30: 'olderThan30d',
  90: 'olderThan90d',
  180: 'olderThan180d',
  365: 'olderThan365d',
} as const;

/** What a refused single-sender enqueue means for that sender. */
const SINGLE_SENDER_SKIP: Record<string, ActionPreviewSkipReason> = {
  PROTECTED_SENDER: 'protected',
  SENDER_NOT_FOUND: 'not_found',
  SENDER_ACTION_IN_PROGRESS: 'in_progress',
  UNSUBSCRIBE_CHANNEL_UNKNOWN: 'unknown',
};

/**
 * Stored previews — the part of the connector that keeps a model from
 * changing mail on its own (ADR-0048 rule 1, spec §3).
 *
 *   preview_cleanup → `create`   a `pending` row, 15 minutes
 *   the person      → `confirm`  on DeclutrMail's page: pending → confirmed
 *                                → the action is enqueued → applied
 *   apply_cleanup   → `apply`    reports the row's state; never confirms
 *
 * `confirm` is reachable only from a cookie-authenticated, CSRF-checked
 * route. `apply` is what the bearer-token tool calls: on a `pending` row
 * it changes nothing. The one thing `apply` can start is a preview the
 * person already confirmed whose enqueue did not finish (queue down);
 * that is the same confirmed preview, not a new decision.
 *
 * Every enqueue uses the idempotency key `mcp-preview:<id>`, so a double
 * click, a retried tool call and both arriving together are one action.
 *
 * No mail logic lives here. Each verb goes to the method the web app
 * calls for it (spec §2); Protected, quota, tier and "sender busy" are
 * decided by those services at the moment of the enqueue.
 */
@Injectable()
export class ActionPreviewsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly actions: ActionsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** `preview_cleanup`: count what the verb would touch and store the request. */
  async create(input: {
    owner: PreviewOwner;
    mailboxAccountId: string;
    verb: ActionPreviewVerb;
    senderIds: readonly string[];
    olderThanDays: 30 | 90 | 180 | 365 | null;
    wakeAt: Date | null;
  }): Promise<{ preview: ActionPreview; skipped: PreviewSkip[] }> {
    const { owner, mailboxAccountId, verb, olderThanDays, wakeAt } = input;
    const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
    assertVerbArguments(verb, olderThanDays, wakeAt, expiresAt);

    const ids = [...new Set(input.senderIds.map((id) => id.toLowerCase()))];
    const facts = await this.senderFacts(mailboxAccountId, ids);
    const skipped: PreviewSkip[] = [];
    const frozen: string[] = [];
    for (const id of ids) {
      const reason = skipAtPreview(verb, facts.get(id));
      if (reason) skipped.push({ senderId: id, reason });
      else frozen.push(id);
    }
    if (frozen.length === 0) {
      throw new McpToolError(
        'NO_ACTIONABLE_SENDERS',
        'None of these senders can be acted on. See skipped for the reason for each.',
        { skipped: skipped.map((s) => ({ sender_id: s.senderId, reason: s.reason })) },
      );
    }

    const emailCount = await this.countEmail(mailboxAccountId, verb, frozen, olderThanDays);
    const [preview] = await this.db
      .insert(actionPreviews)
      .values({
        workspaceId: owner.workspaceId,
        mailboxAccountId,
        userId: owner.userId,
        grantId: owner.grantId,
        verb,
        olderThanDays,
        wakeAt,
        senderIds: frozen,
        emailCount,
        expiresAt,
      })
      .returning();
    return { preview: preview!, skipped };
  }

  /**
   * The row, if it belongs to this person. Anything else — another
   * person's id, an app that was disconnected, a made-up id — is `null`,
   * and the caller answers "not found" for all of them alike.
   */
  async findOwned(previewId: string, userId: string): Promise<PreviewDetail | null> {
    const [row] = await this.db
      .select({
        preview: actionPreviews,
        mailboxEmail: mailboxAccounts.providerAccountId,
        appName: oauthClients.clientName,
      })
      .from(actionPreviews)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionPreviews.mailboxAccountId))
      .innerJoin(
        oauthGrants,
        and(eq(oauthGrants.id, actionPreviews.grantId), isNull(oauthGrants.revokedAt)),
      )
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
      .where(and(eq(actionPreviews.id, previewId), eq(actionPreviews.userId, userId)))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      expired: row.preview.state !== 'applied' && row.preview.expiresAt.getTime() <= Date.now(),
    };
  }

  /**
   * The person pressed the verb on the confirm page. The ONLY path from
   * `pending` to `confirmed`; the caller is a cookie + CSRF route.
   */
  async confirm(previewId: string, userId: string): Promise<PreviewDetail> {
    const found = await this.findOwned(previewId, userId);
    if (!found) throw notFound();
    if (found.preview.state === 'applied') return found;
    if (found.expired) throw expired();
    if (found.preview.state === 'pending') {
      // The expiry is re-checked in the UPDATE itself: the read above is
      // not what authorizes the transition.
      await this.db
        .update(actionPreviews)
        .set({ state: 'confirmed', confirmedAt: sql`now()` })
        .where(
          and(
            eq(actionPreviews.id, previewId),
            eq(actionPreviews.userId, userId),
            eq(actionPreviews.state, 'pending'),
            gt(actionPreviews.expiresAt, sql`now()`),
          ),
        );
    }
    return this.applyConfirmed(previewId, userId);
  }

  /**
   * `apply_cleanup`. Reports the preview; starts nothing the person has
   * not confirmed. `grantId` must be the app that made the preview, and
   * `mailboxAccountId`, when the tool named a mailbox, the preview's own.
   */
  async apply(
    previewId: string,
    owner: PreviewOwner,
    mailboxAccountId: string | null,
  ): Promise<PreviewDetail> {
    const found = await this.findOwned(previewId, owner.userId);
    if (
      !found ||
      found.preview.grantId !== owner.grantId ||
      (mailboxAccountId !== null && found.preview.mailboxAccountId !== mailboxAccountId)
    ) {
      throw notFound();
    }
    if (found.preview.state === 'applied' || found.preview.state === 'pending') {
      if (found.expired) throw expired();
      return found;
    }
    return this.applyConfirmed(previewId, owner.userId);
  }

  /** A confirmed preview: enqueue (idempotent) and record what happened. */
  private async applyConfirmed(previewId: string, userId: string): Promise<PreviewDetail> {
    const found = await this.findOwned(previewId, userId);
    if (!found) throw notFound();
    const { preview } = found;
    if (preview.state === 'applied') return found;
    // Lost the race for the last second of the window, or never confirmed.
    if (preview.state !== 'confirmed') throw expired();
    if (found.expired) throw expired();

    await this.assertMailboxConnected(preview.mailboxAccountId);
    const { result, actionId } = await this.execute(preview);
    // Guarded on `confirmed`: of two requests finishing together, one
    // writes the outcome and the other finds it already written. Both
    // carried the same idempotency key, so both describe one action.
    if (actionId) await this.recordOrigin(preview, actionId);
    await this.db
      .update(actionPreviews)
      .set({ state: 'applied', appliedAt: sql`now()`, actionId, result })
      .where(and(eq(actionPreviews.id, preview.id), eq(actionPreviews.state, 'confirmed')));
    const applied = await this.findOwned(previewId, userId);
    if (!applied) throw notFound();
    return applied;
  }

  /**
   * Whether the action a confirmation started is running, done or failed —
   * read now. A queue that refused the job leaves a `failed` action behind
   * the preview's idempotency key, and "applied" alone would hide that.
   * Null when the verb started no action (Keep, a mailto unsubscribe).
   */
  async actionStatus(preview: ActionPreview): Promise<ActionJobStatus | null> {
    if (!preview.actionId || !preview.result?.handle) return null;
    try {
      const status =
        preview.result.handle === 'batch'
          ? await this.actions.getBatchStatus(preview.actionId, preview.mailboxAccountId)
          : await this.actions.getStatus(preview.actionId, preview.mailboxAccountId);
      return status.status;
    } catch (error) {
      if (exceptionCode(error) === 'ACTION_NOT_FOUND') return null;
      throw error;
    }
  }

  /** Names and compose links for a result's skipped senders, read now. */
  async describeSkipped(
    preview: Pick<ActionPreview, 'mailboxAccountId'>,
    mailboxEmail: string,
    skipped: readonly PreviewSkip[],
  ): Promise<DescribedSkip[]> {
    const facts = await this.senderFacts(
      preview.mailboxAccountId,
      skipped.map((s) => s.senderId),
    );
    return skipped.map((skip) => {
      const sender = facts.get(skip.senderId);
      return {
        ...skip,
        name: sender?.name ?? null,
        composeUrl:
          skip.reason === 'mailto' && sender?.mailtoUrl
            ? gmailComposeUrlFromMailto(mailboxEmail, sender.mailtoUrl)
            : null,
      };
    });
  }

  /** Up to five sender names for the confirm page, in the preview's order. */
  async senderNames(
    preview: Pick<ActionPreview, 'mailboxAccountId' | 'senderIds'>,
  ): Promise<string[]> {
    const first = preview.senderIds.slice(0, NAMED_SENDERS);
    const facts = await this.senderFacts(preview.mailboxAccountId, first);
    return first.flatMap((id) => {
      const sender = facts.get(id);
      return sender ? [sender.name] : [];
    });
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  /** Send the verb to the method the web app uses for it (spec §2). */
  private async execute(
    preview: ActionPreview,
  ): Promise<{ result: ActionPreviewResult; actionId: string | null }> {
    const { mailboxAccountId, verb } = preview;
    const ids = preview.senderIds;
    const idempotencyKey = `mcp-preview:${preview.id}`;
    const nothing = async (): Promise<{ result: ActionPreviewResult; actionId: null }> => ({
      actionId: null,
      result: {
        handle: null,
        appliedSenders: 0,
        requestedEmails: 0,
        skipped: await this.skipsNow(mailboxAccountId, verb, ids),
      },
    });

    if (verb === 'keep') {
      const limit = createLimiter(KEEP_CONCURRENCY);
      const skipped: PreviewSkip[] = [];
      await Promise.all(
        ids.map((senderId) =>
          limit(async () => {
            try {
              await this.actions.recordKeepIntent({ mailboxAccountId, senderId });
            } catch (error) {
              if (exceptionCode(error) !== 'SENDER_NOT_FOUND') throw error;
              skipped.push({ senderId, reason: 'not_found' });
            }
          }),
        ),
      );
      return {
        actionId: null,
        result: {
          handle: null,
          appliedSenders: ids.length - skipped.length,
          requestedEmails: 0,
          skipped,
        },
      };
    }

    if (verb === 'unsubscribe') {
      if (ids.length === 1) {
        const senderId = ids[0]!;
        // The single-sender intent route has no Protected refusal of its
        // own (the web app asks "Unsubscribe anyway?" in the client). The
        // connector never overrides, so it refuses here.
        const facts = (await this.senderFacts(mailboxAccountId, [senderId])).get(senderId);
        if (!facts) return skipOne(senderId, 'not_found');
        if (facts.isProtected) return skipOne(senderId, 'protected');
        try {
          const intent = await this.actions.recordUnsubscribeIntent({
            mailboxAccountId,
            senderId,
            idempotencyKey,
          });
          if (intent.method === 'one_click' && intent.executionActionId) {
            return {
              actionId: intent.executionActionId,
              result: { handle: 'action', appliedSenders: 1, requestedEmails: 0, skipped: [] },
            };
          }
          return skipOne(senderId, intent.method === 'mailto' ? 'mailto' : 'no_channel');
        } catch (error) {
          const reason = SINGLE_SENDER_SKIP[exceptionCode(error) ?? ''];
          if (!reason) throw error;
          return skipOne(senderId, reason);
        }
      }
      try {
        const batch = await this.actions.enqueueBulkUnsubscribe({
          mailboxAccountId,
          senderIds: ids,
          idempotencyKey,
        });
        return {
          actionId: batch.batchId,
          result: {
            handle: 'batch',
            appliedSenders: batch.senderCount,
            requestedEmails: 0,
            skipped: batch.skipped.map(({ senderId, reason }) => ({ senderId, reason })),
          },
        };
      } catch (error) {
        if (exceptionCode(error) !== 'NO_ACTIONABLE_SENDERS') throw error;
        return nothing();
      }
    }

    const primary = {
      type: verb,
      olderThanDays: preview.olderThanDays,
      wakeAt: preview.wakeAt,
      // ADR-0048 rule 2: the connector never reaches past the inbox.
      reach: 'inbox_only' as const,
    };
    if (ids.length === 1) {
      const senderId = ids[0]!;
      try {
        const action = await this.actions.enqueueComposite({
          mailboxAccountId,
          selector: { type: 'sender', senderId },
          primary,
          idempotencyKey,
          // Never: Protected is the one setting that holds after a
          // careless confirm (ADR-0048 rule 2).
          override: false,
        });
        return {
          actionId: action.actionId,
          result: {
            handle: 'action',
            appliedSenders: 1,
            requestedEmails: action.primaryCount,
            skipped: [],
          },
        };
      } catch (error) {
        const reason = SINGLE_SENDER_SKIP[exceptionCode(error) ?? ''];
        if (!reason) throw error;
        return skipOne(senderId, reason);
      }
    }
    try {
      const batch = await this.actions.enqueueBulkComposite({
        mailboxAccountId,
        senderIds: ids,
        primary,
        idempotencyKey,
      });
      return {
        actionId: batch.batchId,
        result: {
          handle: 'batch',
          appliedSenders: batch.senderCount,
          requestedEmails: batch.requestedTotal,
          skipped: batch.skipped.map(({ senderId, reason }) => ({ senderId, reason })),
        },
      };
    } catch (error) {
      if (exceptionCode(error) !== 'NO_ACTIONABLE_SENDERS') throw error;
      return nothing();
    }
  }

  /**
   * Why each sender is skipped when a bulk enqueue refused the whole
   * selection: the refusal carries no per-sender reason, so read it. A
   * sender with no reason of its own was busy with another action.
   */
  private async skipsNow(
    mailboxAccountId: string,
    verb: ActionPreviewVerb,
    ids: readonly string[],
  ): Promise<PreviewSkip[]> {
    const facts = await this.senderFacts(mailboxAccountId, ids);
    return ids.map((senderId) => {
      const sender = facts.get(senderId);
      const reason =
        skipAtPreview(verb, sender) ??
        (verb === 'unsubscribe' && sender?.unsubscribe === 'mailto' ? 'mailto' : 'in_progress');
      return { senderId, reason };
    });
  }

  /** How many inbox emails the verb would move, from the web app's own preview. */
  private async countEmail(
    mailboxAccountId: string,
    verb: ActionPreviewVerb,
    senderIds: readonly string[],
    olderThanDays: 30 | 90 | 180 | 365 | null,
  ): Promise<number> {
    if (verb === 'keep') return 0;
    if (verb === 'unsubscribe') {
      // Unsubscribe acts on future email. Asked now, so a plan that
      // cannot act on several senders is told before the person confirms.
      if (senderIds.length > 1) {
        await this.entitlements.assertActionSelectorTier(
          mailboxAccountId,
          'unsubscribe',
          'multi-sender',
        );
      }
      return 0;
    }
    const bucket = olderThanDays === null ? 'all' : WINDOW_KEY[olderThanDays];
    if (senderIds.length === 1) {
      const preview = await this.actions.previewComposite({
        mailboxAccountId,
        senderId: senderIds[0]!,
      });
      return preview.counts[bucket];
    }
    const preview = await this.actions.previewBulkComposite({
      mailboxAccountId,
      senderIds: [...senderIds],
    });
    return preview.totals[bucket];
  }

  /**
   * ADR-0008 §3 exception: actions → senders, the read the action
   * services make themselves. Identity, Protected state and unsubscribe
   * capability for a set of sender ids in one mailbox.
   */
  private async senderFacts(
    mailboxAccountId: string,
    ids: readonly string[],
  ): Promise<Map<string, SenderFacts>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        id: senders.id,
        senderKey: senders.senderKey,
        displayName: senders.displayName,
        email: senders.email,
        unsubscribeMethod: senders.unsubscribeMethod,
        unsubscribeUrl: senders.unsubscribeUrl,
        isProtected: senderPolicies.isProtected,
      })
      .from(senders)
      .leftJoin(
        senderPolicies,
        and(
          eq(senderPolicies.mailboxAccountId, senders.mailboxAccountId),
          eq(senderPolicies.senderKey, senders.senderKey),
        ),
      )
      .where(and(eq(senders.mailboxAccountId, mailboxAccountId), inArray(senders.id, [...ids])));
    return new Map(
      rows.map((row) => {
        const capability = unsubscribeCapabilityOf(row.unsubscribeMethod);
        // `(method, url)` agree by invariant; a row missing its URL is
        // "no channel", as the action services treat it.
        const unsubscribe =
          capability === 'unknown' ? 'unknown' : row.unsubscribeUrl ? capability : 'none';
        return [
          row.id,
          {
            id: row.id,
            senderKey: row.senderKey,
            name: row.displayName?.trim() || row.email,
            isProtected: row.isProtected === true,
            unsubscribe,
            mailtoUrl: unsubscribe === 'mailto' ? row.unsubscribeUrl : null,
          },
        ];
      }),
    );
  }

  private async assertMailboxConnected(mailboxAccountId: string): Promise<void> {
    const [mailbox] = await this.db
      .select({ status: mailboxAccounts.status })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.id, mailboxAccountId))
      .limit(1);
    if (mailbox?.status !== 'active') {
      throw new McpToolError(
        'MAILBOX_RECONNECT_REQUIRED',
        'This Gmail account is no longer connected to DeclutrMail. Reconnect it in Settings.',
      );
    }
  }

  /**
   * Say which app started these jobs, so Activity can (spec §7). After
   * the enqueue, never inside it: the action pipeline is untouched. One
   * row per job of the action or batch; a repeat changes nothing.
   */
  private async recordOrigin(preview: ActionPreview, actionId: string): Promise<void> {
    // A grant purged between the enqueue and here leaves no row to write;
    // the INSERT then selects nothing.
    await this.db.execute(sql`
      INSERT INTO action_origins (action_job_id, grant_id, client_id)
      SELECT j.id, g.id, g.client_id
      FROM action_jobs j
      JOIN oauth_grants g ON g.id = ${preview.grantId}::uuid
      WHERE j.mailbox_account_id = ${preview.mailboxAccountId}::uuid
        AND coalesce(j.composite_id, j.id) = ${actionId}::uuid
      ON CONFLICT (action_job_id) DO NOTHING
    `);
  }
}

function skipOne(
  senderId: string,
  reason: ActionPreviewSkipReason,
): { result: ActionPreviewResult; actionId: null } {
  return {
    actionId: null,
    result: {
      handle: null,
      appliedSenders: 0,
      requestedEmails: 0,
      skipped: [{ senderId, reason }],
    },
  };
}

/** A sender that cannot be part of a preview at all, and why. */
function skipAtPreview(
  verb: ActionPreviewVerb,
  sender: SenderFacts | undefined,
): ActionPreviewSkipReason | null {
  if (!sender) return 'not_found';
  // Keep changes no mail, so it is the one verb Protected does not stop.
  if (verb !== 'keep' && sender.isProtected) return 'protected';
  if (verb === 'unsubscribe') {
    if (sender.unsubscribe === 'unknown') return 'unknown';
    if (sender.unsubscribe === 'none') return 'no_channel';
  }
  return null;
}

function assertVerbArguments(
  verb: ActionPreviewVerb,
  olderThanDays: number | null,
  wakeAt: Date | null,
  expiresAt: Date,
): void {
  if (olderThanDays !== null && (verb === 'keep' || verb === 'unsubscribe')) {
    throw new McpToolError(
      'INVALID_REQUEST',
      'older_than_days applies to Archive, Later and Delete only.',
    );
  }
  if (verb === 'later') {
    // Later than the preview's own expiry, so a confirmation at the last
    // minute still names a time that has not passed.
    if (wakeAt === null || wakeAt.getTime() <= expiresAt.getTime()) {
      throw new McpToolError(
        'INVALID_REQUEST',
        'Later needs wake_at: a time more than 15 minutes from now.',
      );
    }
  } else if (wakeAt !== null) {
    throw new McpToolError('INVALID_REQUEST', 'wake_at applies to Later only.');
  }
}

function notFound(): McpToolError {
  return new McpToolError('PREVIEW_NOT_FOUND', 'No preview with that id. Create a new one.');
}

function expired(): McpToolError {
  return new McpToolError(
    'PREVIEW_EXPIRED',
    'This preview expired before it was confirmed. Create a new one.',
  );
}
