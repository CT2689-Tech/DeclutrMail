import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { mailboxAccounts, mailboxDataDeletionRequests, ruleMatchLog } from '@declutrmail/db';
import type { MailboxAccount } from '@declutrmail/db';
import {
  ERROR_CODES,
  mailboxDataDeletionConfirmPhrase,
  type ErrorCode,
  type MailboxDataDeletionReceipt,
  type MailboxDataDeletionView,
  type MailboxIndexedDataState,
  type QuietHoursConfig,
  type QuietHoursState,
} from '@declutrmail/shared/contracts';
import {
  isQuietActive,
  msUntilQuietEnds,
  persistQuietHoursState,
  readQuietHoursState,
} from '@declutrmail/workers';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { AppException } from '../common/app-exception.js';
import { TokenCryptoService } from '../auth/token-crypto.service.js';
import {
  EntitlementsService,
  type EntitlementsExecutor,
  type EntitlementsTransaction,
} from '../common/entitlements/entitlements.service.js';
import { GmailWatchService } from './gmail-watch.service.js';

/** Wire shape returned by `list()` for the FE account menu. */
export interface MailboxSummary {
  id: string;
  email: string;
  status: 'active' | 'disconnected';
  connectedAt: string | null;
  indexedDataState: MailboxIndexedDataState;
  dataDeletion: MailboxDataDeletionView | null;
}

/** Canonical persisted identity for Gmail's case-insensitive address space. */
export function canonicalizeGmailProviderAccountId(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * MailboxAccountsService (D205) — owns the `mailbox_accounts` entity.
 *
 * Connect lives in `AuthSignupOrchestrator` (the documented D205
 * exception) because it crosses User + Workspace + Mailbox tables in
 * one transaction. THIS service owns:
 *   - list-by-workspace        (account menu)
 *   - mark active mailbox      (delegates to UsersService.preferences)
 *   - upsert during connect    (called from the orchestrator with tx)
 *   - disconnect (revoke + nullify) — calls Google's revoke endpoint
 *     before nullifying the local row. Local nullification is the hard
 *     product boundary even if Google is temporarily unavailable.
 */
@Injectable()
export class MailboxAccountsService {
  private readonly logger = new Logger(MailboxAccountsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly gmailWatch: GmailWatchService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * List the workspace's connected mailbox accounts. Returns active +
   * disconnected so the FE can show a "Reconnect" affordance per D116.
   */
  async listByWorkspace(workspaceId: string): Promise<MailboxSummary[]> {
    const [rows, deletionRows] = await Promise.all([
      this.db
        .select({
          id: mailboxAccounts.id,
          email: mailboxAccounts.providerAccountId,
          status: mailboxAccounts.status,
          connectedAt: mailboxAccounts.connectedAt,
        })
        .from(mailboxAccounts)
        .where(eq(mailboxAccounts.workspaceId, workspaceId))
        .orderBy(mailboxAccounts.createdAt),
      this.db
        .select({
          mailboxAccountId: mailboxDataDeletionRequests.mailboxAccountId,
          id: mailboxDataDeletionRequests.id,
          status: mailboxDataDeletionRequests.status,
          requestedAt: mailboxDataDeletionRequests.requestedAt,
          executedAt: mailboxDataDeletionRequests.executedAt,
          completedAt: mailboxDataDeletionRequests.completedAt,
        })
        .from(mailboxDataDeletionRequests)
        .innerJoin(
          mailboxAccounts,
          eq(mailboxDataDeletionRequests.mailboxAccountId, mailboxAccounts.id),
        )
        .where(eq(mailboxAccounts.workspaceId, workspaceId))
        .orderBy(desc(mailboxDataDeletionRequests.requestedAt)),
    ]);
    const latestByMailbox = new Map<string, MailboxDataDeletionView>();
    for (const row of deletionRows) {
      if (!latestByMailbox.has(row.mailboxAccountId)) {
        latestByMailbox.set(row.mailboxAccountId, toDeletionView(row));
      }
    }
    return rows.map((row) => toMailboxSummary(row, latestByMailbox.get(row.id) ?? null));
  }

  /** Find a single mailbox by id + workspace (ownership scope). */
  async findOwned(workspaceId: string, mailboxAccountId: string): Promise<MailboxAccount | null> {
    const [row] = await this.db
      .select()
      .from(mailboxAccounts)
      .where(
        and(eq(mailboxAccounts.id, mailboxAccountId), eq(mailboxAccounts.workspaceId, workspaceId)),
      )
      .limit(1);
    return row ?? null;
  }

  /** Destructive lifecycle routes require both workspace and user ownership. */
  async findOwnedByUser(
    workspaceId: string,
    userId: string,
    mailboxAccountId: string,
  ): Promise<MailboxAccount | null> {
    const [row] = await this.db
      .select()
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.id, mailboxAccountId),
          eq(mailboxAccounts.workspaceId, workspaceId),
          eq(mailboxAccounts.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Find a mailbox by its `(provider, providerAccountId)` identity —
   * the home workspace + owner of a Gmail account regardless of which
   * workspace is asking.
   *
   * Powers "login follows mailbox" (Option 1): when someone logs in
   * with an email that was previously connected as a SECONDARY mailbox
   * under another account, `AuthSignupOrchestrator.connect` resolves
   * the session into that mailbox's home workspace instead of
   * bootstrapping an orphan empty one.
   *
   * Returns `null` when the email has never been connected.
   */
  async findByProviderEmail(
    email: string,
    executor: EntitlementsExecutor = this.db,
  ): Promise<{
    mailboxId: string;
    workspaceId: string;
    userId: string;
    status: 'active' | 'disconnected';
  } | null> {
    const providerAccountId = canonicalizeGmailProviderAccountId(email);
    const [row] = await executor
      .select({
        mailboxId: mailboxAccounts.id,
        workspaceId: mailboxAccounts.workspaceId,
        userId: mailboxAccounts.userId,
        status: mailboxAccounts.status,
      })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.provider, 'gmail'),
          eq(mailboxAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Upsert at OAuth-connect time. MUST be called inside a tx provided
   * by `AuthSignupOrchestrator`. Returns the row id so the orchestrator
   * can wire up sync state in the same transaction.
   */
  async upsertConnect(
    tx: EntitlementsTransaction,
    input: {
      workspaceId: string;
      userId: string;
      email: string;
      encryptedRefreshToken: Buffer;
      dekEncrypted: Buffer;
      keyVersion: number;
    },
  ): Promise<{ id: string }> {
    const providerAccountId = canonicalizeGmailProviderAccountId(input.email);
    // Every transition to `active` linearizes on the workspace row. The
    // provider re-read must happen after that lock: an OAuth-start lookup is
    // only a fast-fail and may be stale by callback time.
    const workspace = await this.entitlements.lockInboxWorkspace(input.workspaceId, tx);
    if (!workspace) {
      throw new NotFoundException('Workspace not found.');
    }
    const existing = await this.findByProviderEmail(providerAccountId, tx);
    if (existing && existing.workspaceId !== input.workspaceId) {
      throw new ConflictException({
        code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' satisfies ErrorCode,
        message: ERROR_CODES.MAILBOX_OWNED_BY_OTHER_WORKSPACE.message,
      });
    }

    const [deletionInProgress] = await tx
      .select({ id: mailboxDataDeletionRequests.id })
      .from(mailboxDataDeletionRequests)
      .innerJoin(
        mailboxAccounts,
        eq(mailboxDataDeletionRequests.mailboxAccountId, mailboxAccounts.id),
      )
      .where(
        and(
          eq(mailboxAccounts.provider, 'gmail'),
          eq(mailboxAccounts.providerAccountId, providerAccountId),
          inArray(mailboxDataDeletionRequests.status, ['pending', 'executing', 'failed']),
        ),
      )
      .limit(1);
    if (deletionInProgress) {
      throw new ConflictException({
        code: 'MAILBOX_DATA_DELETION_IN_PROGRESS' satisfies ErrorCode,
        message: 'Indexed data deletion must finish before this Gmail account can reconnect.',
      });
    }
    // An active row already owns its slot, including after a downgrade.
    // Missing/disconnected rows consume a slot and must be checked while the
    // workspace lock is held.
    if (existing?.status !== 'active') {
      await this.entitlements.assertInboxCapacityForWorkspace(workspace, tx);
    }

    const [row] = await tx
      .insert(mailboxAccounts)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        provider: 'gmail',
        providerAccountId,
        encryptedRefreshToken: input.encryptedRefreshToken,
        dekEncrypted: input.dekEncrypted,
        keyVersion: input.keyVersion,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [mailboxAccounts.provider, mailboxAccounts.providerAccountId],
        set: {
          encryptedRefreshToken: input.encryptedRefreshToken,
          dekEncrypted: input.dekEncrypted,
          keyVersion: input.keyVersion,
          connectedAt: new Date(),
          status: 'active',
        },
        // The orchestrator's ownership lookup is only a UX fast-fail:
        // another workspace can win this provider identity after that read.
        // Scope the update to the owning workspace and re-check deletion
        // state after PostgreSQL acquires the conflicting mailbox-row lock.
        setWhere: sql`${mailboxAccounts.workspaceId} = ${input.workspaceId}
          AND NOT EXISTS (
            SELECT 1
            FROM mailbox_data_deletion_requests deletion
            WHERE deletion.mailbox_account_id = ${mailboxAccounts.id}
              AND deletion.status IN ('pending', 'executing', 'failed')
          )`,
      })
      .returning({ id: mailboxAccounts.id });
    if (!row) {
      const [blockedByDeletion] = await tx
        .select({ id: mailboxDataDeletionRequests.id })
        .from(mailboxDataDeletionRequests)
        .innerJoin(
          mailboxAccounts,
          eq(mailboxDataDeletionRequests.mailboxAccountId, mailboxAccounts.id),
        )
        .where(
          and(
            eq(mailboxAccounts.provider, 'gmail'),
            eq(mailboxAccounts.providerAccountId, providerAccountId),
            inArray(mailboxDataDeletionRequests.status, ['pending', 'executing', 'failed']),
          ),
        )
        .limit(1);
      if (blockedByDeletion) {
        throw new ConflictException({
          code: 'MAILBOX_DATA_DELETION_IN_PROGRESS' satisfies ErrorCode,
          message: 'Indexed data deletion must finish before this Gmail account can reconnect.',
        });
      }
      throw new ConflictException({
        code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' satisfies ErrorCode,
        message: ERROR_CODES.MAILBOX_OWNED_BY_OTHER_WORKSPACE.message,
      });
    }
    // A completed request is represented permanently by the security
    // audit event. Remove the transient lifecycle row on reconnect so a
    // later ordinary disconnect correctly reports retained fresh data.
    await tx
      .delete(mailboxDataDeletionRequests)
      .where(
        and(
          eq(mailboxDataDeletionRequests.mailboxAccountId, row.id),
          eq(mailboxDataDeletionRequests.status, 'completed'),
        ),
      );
    return row;
  }

  /**
   * Quiet hours, read path (U18 — D92/D95). `config` is `null` until
   * the mailbox has ever been configured; `activeNow` is the SAME
   * combined predicate (`isQuietActive`) the AutopilotActionWorker
   * defers on, so the UI and the worker never disagree.
   */
  async getQuietHours(workspaceId: string, mailboxAccountId: string): Promise<QuietHoursState> {
    const row = await this.findOwned(workspaceId, mailboxAccountId);
    if (!row) {
      throw new NotFoundException('Mailbox not found in this workspace.');
    }
    return this.toQuietHoursState(row.quietState, mailboxAccountId);
  }

  /**
   * Held-work count for the quiet surface (D96): approved autopilot
   * actions the sweep has not applied yet (`resolution = 'approved' AND
   * intent_applied = false`). An ACTION count (one per sender × rule) —
   * the only held-work figure queryable today. Computed whether or not
   * quiet is active (outside quiet it is the transient approve→sweep
   * in-flight figure).
   */
  private async quietHeldCount(mailboxAccountId: string): Promise<number> {
    const [held] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(ruleMatchLog)
      .where(
        and(
          eq(ruleMatchLog.mailboxAccountId, mailboxAccountId),
          eq(ruleMatchLog.resolution, 'approved'),
          eq(ruleMatchLog.intentApplied, false),
        ),
      );
    return held?.count ?? 0;
  }

  /**
   * Assemble the `QuietHoursState` wire shape shared by the GET + PUT
   * paths: persisted config, the combined `activeNow` predicate the
   * AutopilotActionWorker defers on, the held-action count, and the ISO
   * end of the CURRENT quiet spell (`null` when quiet is inactive or
   * indefinite).
   */
  private async toQuietHoursState(
    quietState: unknown,
    mailboxAccountId: string,
  ): Promise<QuietHoursState> {
    const now = new Date();
    const activeNow = isQuietActive(quietState, now);
    const ms = msUntilQuietEnds(quietState, now);
    return {
      config: readQuietHoursState(quietState),
      activeNow,
      heldCount: await this.quietHeldCount(mailboxAccountId),
      endsAt: activeNow && ms != null ? new Date(now.getTime() + ms).toISOString() : null,
    };
  }

  /**
   * Quiet hours, write path (U18 — D92/D95). Delegates to
   * `persistQuietHoursState`, which writes via jsonb `||` MERGE under
   * the namespaced `quiet_hours` key — NEVER a whole-column replace.
   * `mailbox_accounts.quiet_state` is CO-TENANTED: the Gmail watch
   * pipeline stores `gmail_watch` in the same column, and a replace
   * would silently wipe it and kill push notifications (see
   * `packages/workers/src/quiet-hours-state.ts`).
   *
   * Disconnected mailboxes accept config too — quiet hours are
   * harmless at rest and apply on reconnect.
   */
  async putQuietHours(
    workspaceId: string,
    mailboxAccountId: string,
    config: QuietHoursConfig,
  ): Promise<QuietHoursState> {
    const row = await this.findOwned(workspaceId, mailboxAccountId);
    if (!row) {
      throw new NotFoundException('Mailbox not found in this workspace.');
    }
    await persistQuietHoursState(this.db, mailboxAccountId, config);
    const fresh = await this.findOwned(workspaceId, mailboxAccountId);
    return this.toQuietHoursState(fresh?.quietState, mailboxAccountId);
  }

  /**
   * Disconnect: revoke the refresh token at Google, then nullify the
   * local row. A Google failure is logged, but local credentials are still
   * removed so an upstream outage cannot prevent the user from disconnecting.
   * Returns the disconnected mailbox summary for receipt rendering.
   *
   * `status` flips to `'disconnected'`. The historical `mail_messages`,
   * `triage_decisions`, `activity_log` rows are preserved per D116 so
   * a re-connect resumes the sender history. Account *deletion* (D232)
   * is a separate operation that cascades through the mail tables.
   */
  async disconnect(input: {
    workspaceId: string;
    userId: string;
    mailboxAccountId: string;
  }): Promise<MailboxSummary> {
    const row = await this.findOwnedByUser(input.workspaceId, input.userId, input.mailboxAccountId);
    if (!row) {
      throw new NotFoundException('Mailbox not found in this workspace.');
    }
    if (row.status === 'disconnected') {
      // Idempotent — already disconnected. Return summary unchanged.
      return this.summaryForRow(row);
    }

    // `users.stop` BEFORE the revoke — a revoked token cannot end the
    // Pub/Sub watch, and a lingering watch would push notifications
    // for a mailbox we no longer sync (D8/D229). Best-effort: the
    // service never throws, and an un-stopped watch self-expires in
    // ~7 days (the webhook treats its pushes as designed no-ops).
    await this.gmailWatch.stopMailbox(row.id);

    if (row.encryptedRefreshToken && row.dekEncrypted && row.keyVersion !== null) {
      try {
        const refreshToken = await this.tokenCrypto.decrypt(
          row.encryptedRefreshToken,
          row.dekEncrypted,
        );
        await revokeWithGoogle(refreshToken);
      } catch (err) {
        this.logger.warn(
          `Google revoke failed for mailbox ${row.id}: ${err instanceof Error ? err.message : err}. Proceeding with local nullify.`,
        );
        // We continue rather than throw — a Google API outage must not
        // strand a user wanting to disconnect. The local nullify still
        // blocks the app from using the (possibly stale) refresh.
      }
    }

    await this.db
      .update(mailboxAccounts)
      .set({
        status: 'disconnected',
        encryptedRefreshToken: null,
        dekEncrypted: null,
        keyVersion: null,
      })
      .where(eq(mailboxAccounts.id, row.id));

    return this.summaryForRow({ ...row, status: 'disconnected' });
  }

  /**
   * Disconnect and schedule a resumable purge of this mailbox's indexed
   * Gmail data. The Gmail revoke completes first; the DB transaction then
   * locks the mailbox row, reasserts the disconnected/token-null state, and
   * inserts at most one durable deletion request. The periodic deletion
   * sweep is the source of truth, so a Redis outage cannot lose the request.
   */
  async requestIndexedDataDeletion(input: {
    workspaceId: string;
    userId: string;
    mailboxAccountId: string;
    confirmPhrase: string;
  }): Promise<MailboxDataDeletionReceipt> {
    const owned = await this.findOwnedByUser(
      input.workspaceId,
      input.userId,
      input.mailboxAccountId,
    );
    if (!owned) {
      throw new NotFoundException('Mailbox not found in this workspace.');
    }
    if (input.confirmPhrase !== mailboxDataDeletionConfirmPhrase(owned.providerAccountId)) {
      throw new AppException({
        code: 'MAILBOX_DATA_DELETION_CONFIRM_MISMATCH',
        message: `Type ${mailboxDataDeletionConfirmPhrase(owned.providerAccountId)} exactly to continue.`,
      });
    }

    const latest = await this.latestDeletionForMailbox(owned.id);
    if (owned.status === 'disconnected' && latest?.status === 'completed') {
      return {
        mailbox: {
          id: owned.id,
          email: owned.providerAccountId,
          status: 'disconnected',
          indexedDataState: 'deleted',
        },
        request: latest,
      };
    }

    const disconnected = await this.disconnect(input);
    const request = await this.db.transaction(async (tx) => {
      // Serialize request creation with reconnect/upsert on the same row.
      await tx
        .update(mailboxAccounts)
        .set({
          status: 'disconnected',
          encryptedRefreshToken: null,
          dekEncrypted: null,
          keyVersion: null,
        })
        .where(
          and(
            eq(mailboxAccounts.id, owned.id),
            eq(mailboxAccounts.workspaceId, input.workspaceId),
            eq(mailboxAccounts.userId, input.userId),
          ),
        );

      const [existing] = await tx
        .select()
        .from(mailboxDataDeletionRequests)
        .where(
          and(
            eq(mailboxDataDeletionRequests.mailboxAccountId, owned.id),
            inArray(mailboxDataDeletionRequests.status, ['pending', 'executing', 'failed']),
          ),
        )
        .orderBy(desc(mailboxDataDeletionRequests.requestedAt))
        .limit(1);
      if (existing) return toDeletionView(existing);

      const [inserted] = await tx
        .insert(mailboxDataDeletionRequests)
        .values({ mailboxAccountId: owned.id, status: 'pending' })
        .returning();
      if (!inserted) {
        throw new Error('Failed to schedule indexed data deletion.');
      }
      return toDeletionView(inserted);
    });

    return {
      mailbox: {
        id: disconnected.id,
        email: disconnected.email,
        status: 'disconnected',
        indexedDataState: indexedDataState('disconnected', request),
      },
      request,
    };
  }

  private async summaryForRow(row: MailboxAccount): Promise<MailboxSummary> {
    return toMailboxSummary(
      {
        id: row.id,
        email: row.providerAccountId,
        status: row.status,
        connectedAt: row.connectedAt,
      },
      await this.latestDeletionForMailbox(row.id),
    );
  }

  private async latestDeletionForMailbox(
    mailboxAccountId: string,
  ): Promise<MailboxDataDeletionView | null> {
    const [row] = await this.db
      .select()
      .from(mailboxDataDeletionRequests)
      .where(eq(mailboxDataDeletionRequests.mailboxAccountId, mailboxAccountId))
      .orderBy(desc(mailboxDataDeletionRequests.requestedAt))
      .limit(1);
    return row ? toDeletionView(row) : null;
  }
}

function toDeletionView(row: {
  id: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  requestedAt: Date;
  executedAt: Date | null;
  completedAt: Date | null;
}): MailboxDataDeletionView {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.executedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function indexedDataState(
  mailboxStatus: 'active' | 'disconnected',
  deletion: MailboxDataDeletionView | null,
): MailboxIndexedDataState {
  if (mailboxStatus === 'active') return 'indexed';
  switch (deletion?.status) {
    case 'pending':
      return 'deletion_pending';
    case 'executing':
      return 'deleting';
    case 'failed':
      return 'deletion_delayed';
    case 'completed':
      return 'deleted';
    default:
      return 'retained';
  }
}

function toMailboxSummary(
  row: {
    id: string;
    email: string;
    status: 'active' | 'disconnected';
    connectedAt: Date | null;
  },
  deletion: MailboxDataDeletionView | null,
): MailboxSummary {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    connectedAt: row.connectedAt?.toISOString() ?? null,
    indexedDataState: indexedDataState(row.status, deletion),
    dataDeletion: deletion,
  };
}

/**
 * Revoke a Google OAuth refresh token. Google's documented endpoint
 * accepts the token in either the query string or the body; we send
 * it as `application/x-www-form-urlencoded` POST body.
 *
 * https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
 *
 * A 200 means the token was revoked (or was already invalid — both
 * outcomes leave the user disconnected, which is what we want). Any
 * other status is logged by the caller; the local nullify proceeds
 * regardless so a Google outage does not strand the user.
 */
async function revokeWithGoogle(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({ token: refreshToken });
  const res = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // 400 with `invalid_token` means the token was already invalid —
    // that's a successful outcome for our purposes.
    const text = await res.text().catch(() => '');
    if (res.status === 400 && text.includes('invalid_token')) {
      return;
    }
    throw new Error(`Google revoke returned ${res.status}: ${text}`);
  }
}
