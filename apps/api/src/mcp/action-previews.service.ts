import { ConflictException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, gt, gte, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm';

import {
  accountDeletionRequests,
  actionJobs,
  actionPreviews,
  mailboxAccounts,
  oauthClients,
  oauthGrants,
  senderPolicies,
  senders,
  type ActionJobStatus,
  type ActionPreview,
  type ActionPreviewAlsoVerb,
  type ActionPreviewResult,
  type ActionPreviewSkipReason,
  type ActionPreviewVerb,
} from '@declutrmail/db';
import { unsubscribeCapabilityOf } from '@declutrmail/shared/actions';
import type { ProductEventsPort } from '@declutrmail/shared/analytics/product-events';
import { gmailComposeUrlFromMailto } from '@declutrmail/shared/contracts';
import { createLimiter, UNSUB_SEND_DISABLED_CODE, unsubSendsEnabled } from '@declutrmail/workers';

import { ActionsService } from '../actions/actions.service.js';
import type { UnsubscribeBacklogSenderResult } from '../actions/actions.types.js';
import { UnsubscribeBacklogService } from '../actions/unsubscribe-backlog.service.js';
import { PRODUCT_EVENTS, recordProductEvent } from '../analytics/product-events.port.js';
import { EntitlementsService } from '../common/entitlements/entitlements.service.js';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { exceptionCode, McpToolError, toToolError } from './mcp-tool-errors.js';

/** How long a person has to confirm (spec §3). */
export const PREVIEW_TTL_MS = 15 * 60 * 1000;
/**
 * How long a request that lost the race to start a confirmed preview
 * waits for the winner before answering "still starting".
 */
const CLAIM_WAIT_MS = 3_000;
/** How long one request's claim on a confirmed preview holds (the UPDATE below). */
export const CLAIM_LEASE_MS = 2 * 60 * 1000;
const CLAIM_POLL_MS = 150;
/** Keep writes one decision per sender; this many at a time. */
const KEEP_CONCURRENCY = 8;

export interface PreviewSkip {
  senderId: string;
  reason: ActionPreviewSkipReason;
  /** Unsubscribe with Archive or Delete: not unsubscribed, but its email was moved. */
  emailMoved?: boolean;
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
  /** True once the 15 minutes are up and the request was not applied. */
  expired: boolean;
  /** False once the preview's Gmail account is disconnected. */
  mailboxConnected: boolean;
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
  // Another unsubscribe to this sender is still being sent: the same
  // "busy" the bulk and existing-email paths report, not a failure.
  UNSUBSCRIBE_IN_FLIGHT: 'in_progress',
  UNSUBSCRIBE_CHANNEL_UNKNOWN: 'unknown',
};

/**
 * Stored previews — the part of the connector that keeps a model from
 * changing mail on its own (ADR-0048 rule 1, spec §3).
 *
 *   preview_cleanup → `create`   a `pending` row, 15 minutes
 *   the person      → `confirm`  on DeclutrMail's page: pending → confirmed
 *                                → the action is enqueued → applied
 *   the person      → `confirmInChat`  Accept on the prompt the server
 *                                sent through the client (elicitation)
 *   apply_cleanup   → `apply`    reports the row's state; never confirms
 *
 * `confirm` is reached from a cookie-authenticated, CSRF-checked route,
 * or through `confirmInChat`, which only the person's Accept on a signed,
 * server-sent prompt reaches. Those are the only things that start an
 * action. `apply` is what the bearer-token tool calls without an Accept:
 * it reports the row and starts nothing, in any state. A start that failed is continued by the person's next
 * press, never by the app (CLAUDE.md §2.6, D233; spec §8).
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
  private readonly logger = new Logger(ActionPreviewsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly actions: ActionsService,
    private readonly entitlements: EntitlementsService,
    private readonly unsubscribeBacklog: UnsubscribeBacklogService,
    @Optional() @Inject(PRODUCT_EVENTS) private readonly productEvents?: ProductEventsPort,
  ) {}

  /** `preview_cleanup`: count what the verb would touch and store the request. */
  async create(input: {
    owner: PreviewOwner;
    mailboxAccountId: string;
    verb: ActionPreviewVerb;
    /** Unsubscribe only: Archive or Delete the senders' existing email too. */
    alsoVerb: ActionPreviewAlsoVerb | null;
    senderIds: readonly string[];
    olderThanDays: 30 | 90 | 180 | 365 | null;
    wakeAt: Date | null;
  }): Promise<{ preview: ActionPreview; skipped: PreviewSkip[] }> {
    const { owner, mailboxAccountId, verb, alsoVerb, olderThanDays, wakeAt } = input;
    // Only to check the arguments: the stored expiry is set by the
    // database's clock, the one every later UPDATE judges it by.
    const earliestExpiry = new Date(Date.now() + PREVIEW_TTL_MS);
    assertVerbArguments(verb, alsoVerb, olderThanDays, wakeAt, earliestExpiry);

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

    const emailCount = await this.countEmail(
      mailboxAccountId,
      verb,
      alsoVerb,
      frozen,
      olderThanDays,
    );
    const [preview] = await this.db
      .insert(actionPreviews)
      .values({
        workspaceId: owner.workspaceId,
        mailboxAccountId,
        userId: owner.userId,
        grantId: owner.grantId,
        verb,
        alsoVerb,
        olderThanDays,
        wakeAt,
        senderIds: frozen,
        emailCount,
        expiresAt: sql`now() + make_interval(secs => ${PREVIEW_TTL_MS / 1000})`,
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
        mailboxStatus: mailboxAccounts.status,
        appName: oauthClients.clientName,
        // The database's clock, the one every UPDATE below is judged by.
        pastExpiry: sql<boolean>`${actionPreviews.expiresAt} <= now()`,
      })
      .from(actionPreviews)
      .innerJoin(mailboxAccounts, eq(mailboxAccounts.id, actionPreviews.mailboxAccountId))
      .innerJoin(
        oauthGrants,
        and(eq(oauthGrants.id, actionPreviews.grantId), isNull(oauthGrants.revokedAt)),
      )
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthGrants.clientId))
      .where(
        and(
          eq(actionPreviews.id, previewId),
          eq(actionPreviews.userId, userId),
          // Spec §7: a disconnect ends the mailbox's previews. Reconnecting
          // reuses the same mailbox row, so a preview made before the
          // current connection began belongs to a connection that ended.
          or(
            isNull(mailboxAccounts.connectedAt),
            gte(actionPreviews.createdAt, mailboxAccounts.connectedAt),
          ),
          // The same second line the token lookup has: an account on its
          // way out confirms nothing, even if its grant were never revoked.
          notExists(
            this.db
              .select({ id: accountDeletionRequests.id })
              .from(accountDeletionRequests)
              .where(
                and(
                  eq(accountDeletionRequests.userId, actionPreviews.userId),
                  inArray(accountDeletionRequests.status, ['pending', 'executing']),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      preview: row.preview,
      mailboxEmail: row.mailboxEmail,
      appName: row.appName,
      expired: row.preview.state !== 'applied' && row.pastExpiry === true,
      mailboxConnected: row.mailboxStatus === 'active',
    };
  }

  /**
   * The person pressed the verb on the confirm page. With
   * `confirmInChat`, the only paths from `pending` to `confirmed`; the
   * caller is a cookie + CSRF route.
   */
  async confirm(previewId: string, userId: string): Promise<PreviewDetail> {
    const found = await this.findOwned(previewId, userId);
    if (!found) throw notFound();
    if (found.preview.state === 'applied') return found;
    if (found.expired) throw expired(found.preview);
    // Before the press is recorded: a refused press leaves no confirmation
    // behind for a later reconnect to pick up.
    if (!found.mailboxConnected) throw mailboxDisconnected();
    if (found.preview.state === 'pending') {
      // The expiry is re-checked in the UPDATE itself: the read above is
      // not what authorizes the transition.
      await this.db
        .update(actionPreviews)
        // A new press: whatever refused the last one is history.
        .set({ state: 'confirmed', confirmedAt: sql`now()`, refusedCode: null })
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
   * `apply_cleanup`. Reports the preview and starts nothing, in any state:
   * only the person's press does (ADR-0048 rule 1). `grantId` must be the
   * app that made the preview, and `mailboxAccountId`, when the tool named
   * a mailbox, the preview's own.
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
    if (found.preview.state === 'applied') return found;
    if (found.expired) throw expired(found.preview);
    // Said now, not after the person has gone to the page and pressed.
    if (!found.mailboxConnected) throw mailboxDisconnected();
    return found;
  }

  /**
   * The person pressed Accept on the prompt this server sent for this
   * preview, through the app that made it. The same ownership checks as
   * `apply`, then the same transition as the confirm page's press — but
   * only from a fresh `pending`. The Accept's signed state lives ten
   * minutes and a client can send it again, so it must never be what:
   *  - re-confirms a press the plan or quota refused (that press is
   *    spent: only a new one starts it), or
   *  - continues a start that failed while `confirmed` (D233: a failed
   *    start is continued only by a new press on the confirm page).
   * Either way the row is reported as it is, like `apply`.
   */
  async confirmInChat(
    previewId: string,
    owner: PreviewOwner,
    mailboxAccountId: string | null,
  ): Promise<PreviewDetail> {
    const found = await this.apply(previewId, owner, mailboxAccountId);
    const { state, refusedCode } = found.preview;
    if (state !== 'pending' || refusedCode !== null) return found;
    // The condition is part of the transition, not only the read above:
    // a refusal recorded in between (a page press racing this) keeps it
    // pending, and this Accept then reports the row instead of starting.
    const [moved] = await this.db
      .update(actionPreviews)
      .set({ state: 'confirmed', confirmedAt: sql`now()` })
      .where(
        and(
          eq(actionPreviews.id, previewId),
          eq(actionPreviews.userId, owner.userId),
          eq(actionPreviews.grantId, owner.grantId),
          eq(actionPreviews.state, 'pending'),
          isNull(actionPreviews.refusedCode),
          gt(actionPreviews.expiresAt, sql`now()`),
        ),
      )
      .returning({ id: actionPreviews.id });
    if (!moved) {
      // Confirmed by the page in the meantime: that press is starting it.
      const now = await this.findOwned(previewId, owner.userId);
      if (!now) throw notFound();
      return now;
    }
    return this.applyConfirmed(previewId, owner.userId);
  }

  /**
   * A confirmed preview: start its action and record what happened.
   *
   * One request at a time. Jobs are safe to enqueue twice (the key makes
   * a replay), but Keep and an email unsubscribe write a decision with no
   * key, so two requests running this together — a click and the
   * assistant's own `apply_cleanup` — would each record one. The claim is
   * a lease on the row, taken and judged by the database.
   */
  private async applyConfirmed(previewId: string, userId: string): Promise<PreviewDetail> {
    const found = await this.findOwned(previewId, userId);
    if (!found) throw notFound();
    const { preview } = found;
    if (preview.state === 'applied') return found;
    if (found.expired) throw expired(preview);
    if (preview.state === 'pending') {
      // Another press was refused and put the row back in the meantime:
      // what the person needs is that refusal, not "expired".
      if (preview.refusedCode !== null) return found;
      // Never confirmed: the press lost the race with the window's end.
      throw expired(preview);
    }
    // A cleanup prepared for a Gmail account must not outlive its
    // connection (spec §7). The rows themselves go with the data purge
    // or the retention sweep; this is what makes them unusable at once.
    if (!found.mailboxConnected) throw mailboxDisconnected();

    const [claimed] = await this.db
      .update(actionPreviews)
      .set({ claimedAt: sql`now()` })
      .where(
        and(
          eq(actionPreviews.id, preview.id),
          eq(actionPreviews.state, 'confirmed'),
          // Not the read above: this is what refuses a start after expiry.
          gt(actionPreviews.expiresAt, sql`now()`),
          or(
            isNull(actionPreviews.claimedAt),
            lt(actionPreviews.claimedAt, sql`now() - interval '2 minutes'`),
          ),
        ),
      )
      .returning({ id: actionPreviews.id });
    if (!claimed) return this.waitForApplied(previewId, userId);

    let outcome: Awaited<ReturnType<ActionPreviewsService['execute']>>;
    try {
      outcome = await this.execute(preview);
      const started = [outcome.actionId, ...(outcome.alsoStarted ?? [])].filter(
        (id): id is string => id !== null,
      );
      if (started.length > 0) await this.recordOrigin(preview, started);
    } catch (error) {
      const refusal = refusalOf(error);
      if (refusal) {
        // Refused for a reason the person must act on (the monthly limit,
        // a plan, sending switched off). Their press is spent: back to
        // pending, so after an upgrade or a reset the assistant cannot
        // start it without a new press.
        const spent = await this.db
          .update(actionPreviews)
          .set({ state: 'pending', confirmedAt: null, claimedAt: null, refusedCode: refusal })
          .where(and(eq(actionPreviews.id, preview.id), eq(actionPreviews.state, 'confirmed')))
          .returning({ id: actionPreviews.id })
          .then((rows) => rows.length > 0)
          .catch((cause: unknown) => {
            // The original refusal is what the caller needs, so it is the
            // one thrown. Unrecorded, the press is not spent: once the
            // lease lapses, a start after an upgrade would need no new
            // press. Rare (the database refused one UPDATE), and reported.
            this.reportUnrecorded(
              'action_preview.refusal_not_recorded',
              preview.id,
              cause,
              refusal,
            );
            return false;
          });
        // Counted once per spent press: an unrecorded refusal spent nothing.
        if (spent) {
          recordProductEvent(
            this.productEvents,
            'connector_request_refused',
            { verb: preview.verb, preview_id: preview.id, reason: refusal },
            userId,
          );
        }
      } else {
        // A fault, not a decision (a database error, the queue down).
        await this.afterFault(preview).catch((cause: unknown) => {
          // Unrecorded, the claim lapses with its lease and the row stays
          // confirmed: only a press continues it either way.
          this.reportUnrecorded('action_preview.fault_not_recorded', preview.id, cause);
        });
      }
      throw error;
    }
    // A replay of a start whose jobs already failed: reported as it is,
    // and not counted as a request that started.
    const startFailed =
      outcome.actionId !== null &&
      (await this.actionStatus({ ...preview, actionId: outcome.actionId, result: outcome.result })
        .then((status) => status === 'failed')
        .catch(() => false));
    const [marked] = await this.db
      .update(actionPreviews)
      .set({
        state: 'applied',
        appliedAt: sql`now()`,
        actionId: outcome.actionId,
        result: outcome.result,
      })
      .where(and(eq(actionPreviews.id, preview.id), eq(actionPreviews.state, 'confirmed')))
      .returning({ id: actionPreviews.id });
    // Counted when this request applied it to at least one sender; a
    // request that found every sender skipped started nothing.
    if (marked && outcome.result.appliedSenders > 0 && !startFailed) {
      recordProductEvent(
        this.productEvents,
        'connector_request_started',
        { verb: preview.verb, preview_id: preview.id },
        userId,
      );
    }
    const applied = await this.findOwned(previewId, userId);
    if (!applied) throw notFound();
    return applied;
  }

  /**
   * After a start failed for a reason that is not a refusal. Nothing the
   * press wrote: the press is spent and the row waits for a new one, as a
   * refusal does (spec §8). Jobs written: the row stays confirmed, so the
   * person's next press replays exactly those jobs and reports what they
   * did; a failed job is reported, never run again (D233).
   */
  private async afterFault(preview: ActionPreview): Promise<void> {
    const written = (await this.previewJobs(preview)).length > 0;
    await this.db
      .update(actionPreviews)
      .set(
        written
          ? { claimedAt: null }
          : { state: 'pending', confirmedAt: null, claimedAt: null, refusedCode: null },
      )
      .where(and(eq(actionPreviews.id, preview.id), eq(actionPreviews.state, 'confirmed')));
  }

  /**
   * The jobs this preview's press wrote, found by the exact keys the
   * action services store under its idempotency key (one sender:
   * `<verb>-<key>`; several: `<verb>-<key>-<sender id>`; `-sec` for a
   * composite's second verb; one-click sends: `unsubexec-<key>…`). Exact
   * keys, so the unique index serves the lookup under any collation.
   */
  private async previewJobs(
    preview: Pick<ActionPreview, 'id' | 'mailboxAccountId' | 'verb' | 'alsoVerb' | 'senderIds'>,
  ): Promise<Array<{ status: ActionJobStatus }>> {
    const safeKey = `mcp-preview-${preview.id}`;
    const prefixes = [...new Set([preview.verb, preview.alsoVerb, 'unsubexec'])].filter(
      (prefix): prefix is string => prefix !== null && prefix !== 'keep',
    );
    const suffixes = ['', ...preview.senderIds.map((id) => `-${id}`)];
    const keys = prefixes.flatMap((prefix) =>
      suffixes.flatMap((suffix) => [
        `${prefix}-${safeKey}${suffix}`,
        `${prefix}-${safeKey}${suffix}-sec`,
      ]),
    );
    return this.db
      .select({ status: actionJobs.status })
      .from(actionJobs)
      .where(
        and(
          eq(actionJobs.mailboxAccountId, preview.mailboxAccountId),
          inArray(actionJobs.idempotencyKey, keys),
        ),
      );
  }

  /**
   * Another request holds the claim. Wait briefly for it to finish, then
   * answer with whatever is true: `applied`, or still `confirmed` — which
   * the tool reports as "in progress" and the page as "press to retry".
   */
  private async waitForApplied(previewId: string, userId: string): Promise<PreviewDetail> {
    const deadline = Date.now() + CLAIM_WAIT_MS;
    for (;;) {
      const found = await this.findOwned(previewId, userId);
      if (!found) throw notFound();
      if (found.preview.state === 'applied') return found;
      if (found.expired) throw expired(found.preview);
      if (Date.now() >= deadline) return found;
      await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS));
    }
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

  /**
   * Every sender in the preview, by name, A–Z — what the confirm page
   * lists. All of them, and in the server's order: the ids arrived in an
   * order the assistant chose, and a page that showed only the first few
   * would let a long request hide one sender behind "and 195 more".
   */
  async senderNames(
    preview: Pick<ActionPreview, 'mailboxAccountId' | 'senderIds'>,
  ): Promise<string[]> {
    const facts = await this.senderFacts(preview.mailboxAccountId, preview.senderIds);
    return [...facts.values()]
      .map((sender) => sender.name)
      .sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' }));
  }

  /* ───────────────────────────── internals ───────────────────────────── */

  /** A write after a failed start did not land: logged, and sent to Sentry as a warning. */
  private reportUnrecorded(kind: string, previewId: string, cause: unknown, code?: string): void {
    const error = cause instanceof Error ? cause.name : 'unknown error';
    this.logger.error(JSON.stringify({ kind, previewId, code: code ?? null, error }));
    void import('@sentry/node')
      .then((Sentry) => {
        Sentry.withScope((scope) => {
          scope.setLevel('warning');
          scope.setTag('mcp_preview_write', kind);
          Sentry.captureException(cause);
        });
      })
      .catch(() => {
        // Sentry is unavailable; the log line above is the record.
      });
  }

  /** Send the verb to the method the web app uses for it (spec §2). */
  private async execute(preview: ActionPreview): Promise<{
    result: ActionPreviewResult;
    actionId: string | null;
    /** Other jobs it started, for the "via <app>" record. */
    alsoStarted?: readonly string[];
  }> {
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
      // Every write settles before a failure is reported: the claim is
      // released only once nothing of this attempt is still running, so a
      // retry cannot write the same decision alongside it.
      const settled = await Promise.allSettled(
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
      const failure = settled.find((result) => result.status === 'rejected');
      if (failure) throw failure.reason;
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

    if (verb === 'unsubscribe' && preview.alsoVerb !== null) {
      // Refused before anything moves, as the web app's bulk unsubscribe
      // refuses: otherwise the email would be moved and every unsubscribe
      // would then fail.
      if (!unsubSendsEnabled()) {
        throw new ConflictException({
          code: UNSUB_SEND_DISABLED_CODE,
          message: 'Unsubscribe sending is disabled in this environment.',
        });
      }
      // The web app's own one-confirmation path: the Archive or Delete is
      // enqueued first (a plan limit refuses it before any unsubscribe is
      // recorded), then one unsubscribe per sender, linked to it.
      let done: Awaited<ReturnType<UnsubscribeBacklogService['confirm']>>;
      try {
        done = await this.unsubscribeBacklog.confirm({
          mailboxAccountId,
          idempotencyKey,
          mode: preview.alsoVerb,
          senderIds: [...ids],
          olderThanDays: preview.olderThanDays,
          // ADR-0048 rule 2: the connector never reaches past the inbox.
          reach: 'inbox_only',
          override: false,
        });
      } catch (error) {
        // The move was refused before any unsubscribe was recorded. A busy
        // sender is a skip, as in the other branches, not an error.
        if (exceptionCode(error) === 'NO_ACTIONABLE_SENDERS') return nothing();
        const reason =
          ids.length === 1 ? SINGLE_SENDER_SKIP[exceptionCode(error) ?? ''] : undefined;
        if (!reason) throw error;
        return skipOne(ids[0]!, reason);
      }
      // Two halves per sender: `skipped` lists who was not unsubscribed,
      // and says whether their email was moved all the same.
      const skipped = done.senders.flatMap((sender) => {
        const reason = backlogSkip(sender);
        if (!reason) return [];
        return [{ senderId: sender.senderId, reason, emailMoved: sender.emailMoved === true }];
      });
      return {
        actionId: done.backlog?.actionId ?? null,
        alsoStarted: done.senders.flatMap((sender) =>
          sender.executionActionId ? [sender.executionActionId] : [],
        ),
        result: {
          handle: done.backlog?.handle ?? null,
          // Acted on: an unsubscribe was sent, or their email was moved.
          appliedSenders: done.senders.filter(
            (sender) => sender.unsubStatus === 'requested' || sender.emailMoved === true,
          ).length,
          requestedEmails: done.backlog?.requestedCount ?? 0,
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
    alsoVerb: ActionPreviewAlsoVerb | null,
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
      // With an Archive or Delete, the email it moves is counted below.
      if (alsoVerb === null) return 0;
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
   * A read-only cross-feature read (connector → senders, sender
   * policies): identity, Protected state and unsubscribe capability for a
   * set of sender ids in one mailbox — the same lookup the action
   * services make before an enqueue. Not yet a row in ADR-0008 §3's
   * table; listed for the founder in the PR.
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

  /**
   * Say which app started these jobs, so Activity can (spec §7). After
   * the enqueue, never inside it: the action pipeline is untouched. One
   * row per job of the action or batch; a repeat changes nothing.
   */
  private async recordOrigin(preview: ActionPreview, actionIds: readonly string[]): Promise<void> {
    await this.recordOriginFor(preview.grantId, preview.mailboxAccountId, actionIds);
  }

  /**
   * The activity rows a change the app made on its own wrote (a Protect:
   * no job, no confirmation), so Activity says "By <app>". Called inside
   * the policy write's transaction, so the row and its origin land together.
   */
  async recordActivityOrigin(
    tx: { execute: DrizzleDb['execute'] },
    grantId: string,
    activityLogIds: readonly string[],
  ): Promise<void> {
    if (activityLogIds.length === 0) return;
    const ids = sql.join(
      activityLogIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    await tx.execute(sql`
      INSERT INTO activity_origins (activity_log_id, grant_id, client_id)
      SELECT a.id, g.id, g.client_id
      FROM activity_log a
      JOIN oauth_grants g ON g.id = ${grantId}::uuid
      WHERE a.id IN (${ids})
      ON CONFLICT (activity_log_id) DO NOTHING
    `);
  }

  /** The reverse jobs an app's `undo` queued, so Activity can say "Undone via <app>". */
  async recordUndoOrigin(
    grantId: string,
    mailboxAccountId: string,
    reverseActionIds: readonly string[],
  ): Promise<void> {
    if (reverseActionIds.length === 0) return;
    await this.recordOriginFor(grantId, mailboxAccountId, reverseActionIds);
  }

  /**
   * Whether this app started the decision behind an undo token: one of
   * its forward jobs carries an origin from the same app. An app undoes
   * only what it did; the person undoes everything else in DeclutrMail.
   */
  async startedByClient(
    mailboxAccountId: string,
    undoToken: string,
    clientId: string,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1
      FROM action_jobs j
      JOIN action_origins o ON o.action_job_id = j.id
      WHERE j.mailbox_account_id = ${mailboxAccountId}::uuid
        AND j.undo_token = ${undoToken}::uuid
        AND j.direction = 'forward'
        AND o.client_id = ${clientId}
      LIMIT 1
    `);
    return rowsOf(result).length > 0;
  }

  private async recordOriginFor(
    grantId: string,
    mailboxAccountId: string,
    actionIds: readonly string[],
  ): Promise<void> {
    const ids = sql.join(
      actionIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    // A grant purged between the enqueue and here leaves no row to write;
    // the INSERT then selects nothing.
    await this.db.execute(sql`
      INSERT INTO action_origins (action_job_id, grant_id, client_id)
      SELECT j.id, g.id, g.client_id
      FROM action_jobs j
      JOIN oauth_grants g ON g.id = ${grantId}::uuid
      WHERE j.mailbox_account_id = ${mailboxAccountId}::uuid
        AND (j.id IN (${ids}) OR j.composite_id IN (${ids}))
      ON CONFLICT (action_job_id) DO NOTHING
    `);
  }
}

/** Rows from `db.execute`, whichever driver ran it (postgres.js: an array; PGlite: `{ rows }`). */
function rowsOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
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
  alsoVerb: ActionPreviewAlsoVerb | null,
  olderThanDays: number | null,
  wakeAt: Date | null,
  expiresAt: Date,
): void {
  if (alsoVerb !== null && verb !== 'unsubscribe') {
    throw new McpToolError('INVALID_REQUEST', 'existing_email applies to Unsubscribe only.');
  }
  if (
    olderThanDays !== null &&
    (verb === 'keep' || (verb === 'unsubscribe' && alsoVerb === null))
  ) {
    throw new McpToolError(
      'INVALID_REQUEST',
      'older_than_days applies to Archive, Later and Delete, and to Unsubscribe with existing_email.',
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

/**
 * The window closed. A preview the person DID confirm can reach here if
 * its action never got recorded (a failure between the press and the
 * enqueue's answer); whether anything ran is then not known from this
 * row, so the message says where to look instead of "nothing happened".
 */
function expired(preview: Pick<ActionPreview, 'state'>): McpToolError {
  return preview.state === 'confirmed'
    ? new McpToolError(
        'PREVIEW_EXPIRED',
        'This preview was confirmed, but DeclutrMail could not confirm it started before it expired. Check list_recent_actions before creating a new one.',
      )
    : new McpToolError(
        'PREVIEW_EXPIRED',
        'This preview expired before it was confirmed. Create a new one.',
      );
}

function mailboxDisconnected(): McpToolError {
  return new McpToolError(
    'MAILBOX_RECONNECT_REQUIRED',
    'This Gmail account is no longer connected to DeclutrMail. Reconnect it in Settings.',
  );
}

/**
 * A start refused for a reason the person has to act on, as the tool
 * error code that names it; null for anything else (the queue was down,
 * an unexpected error), where the press stands and a retry continues.
 */
export function refusalOf(error: unknown): string | null {
  const tool = toToolError(error);
  return tool && REFUSALS.has(tool.code) ? tool.code : null;
}

/**
 * The reasons that spend a press: each names something the person has to
 * change before the same request could start, and none is raised after
 * anything was started. Every other failure keeps the press.
 */
export const REFUSALS: ReadonlySet<string> = new Set([
  'QUOTA_EXHAUSTED',
  'UPGRADE_REQUIRED',
  'UNSUBSCRIBE_UNAVAILABLE',
]);

/** Why one sender of an Unsubscribe-with-Archive/Delete was not unsubscribed. */
function backlogSkip(sender: UnsubscribeBacklogSenderResult): ActionPreviewSkipReason | null {
  if (sender.unsubStatus === 'requested') return null;
  // The person sends it themself (D230); the email was still moved.
  if (sender.unsubStatus === 'manual') return 'mailto';
  switch (sender.reasonCode) {
    case 'protected':
      return 'protected';
    case 'not_found':
      return 'not_found';
    case 'in_flight':
      return 'in_progress';
    case 'mailto_only':
      return 'mailto';
    case 'no_link':
      return 'no_channel';
    case 'method_unknown':
      return 'unknown';
    default:
      return 'failed';
  }
}
