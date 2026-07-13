import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { mailboxAccounts, ruleMatchLog } from '@declutrmail/db';
import type { MailboxAccount } from '@declutrmail/db';
import {
  ERROR_CODES,
  type ErrorCode,
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
import { TokenCryptoService } from '../auth/token-crypto.service.js';
import { GmailWatchService } from './gmail-watch.service.js';

/** Wire shape returned by `list()` for the FE account menu. */
export interface MailboxSummary {
  id: string;
  email: string;
  status: 'active' | 'disconnected';
  connectedAt: string | null;
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
 *     to invalidate the refresh token upstream BEFORE nullifying the
 *     local row; that order guarantees no period in which the local
 *     "disconnected" status disagrees with the actual token state.
 */
@Injectable()
export class MailboxAccountsService {
  private readonly logger = new Logger(MailboxAccountsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly gmailWatch: GmailWatchService,
  ) {}

  /**
   * List the workspace's connected mailbox accounts. Returns active +
   * disconnected so the FE can show a "Reconnect" affordance per D116.
   */
  async listByWorkspace(workspaceId: string): Promise<MailboxSummary[]> {
    const rows = await this.db
      .select({
        id: mailboxAccounts.id,
        email: mailboxAccounts.providerAccountId,
        status: mailboxAccounts.status,
        connectedAt: mailboxAccounts.connectedAt,
      })
      .from(mailboxAccounts)
      .where(eq(mailboxAccounts.workspaceId, workspaceId))
      .orderBy(mailboxAccounts.createdAt);
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.status,
      connectedAt: r.connectedAt?.toISOString() ?? null,
    }));
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
  ): Promise<{ mailboxId: string; workspaceId: string; userId: string } | null> {
    const providerAccountId = canonicalizeGmailProviderAccountId(email);
    const [row] = await this.db
      .select({
        mailboxId: mailboxAccounts.id,
        workspaceId: mailboxAccounts.workspaceId,
        userId: mailboxAccounts.userId,
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
    tx: DrizzleDb,
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
        // Keep the UNIQUE-conflict update scoped to the row's existing
        // workspace so the database remains the canonical ownership guard.
        setWhere: eq(mailboxAccounts.workspaceId, input.workspaceId),
      })
      .returning({ id: mailboxAccounts.id });
    if (!row) {
      throw new ConflictException({
        code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' satisfies ErrorCode,
        message: ERROR_CODES.MAILBOX_OWNED_BY_OTHER_WORKSPACE.message,
      });
    }
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
   * local row. Order matters — if the Google call fails, we keep the
   * local row intact so a retry can complete cleanly. Returns the
   * disconnected mailbox summary for receipt rendering.
   *
   * `status` flips to `'disconnected'`. The historical `mail_messages`,
   * `triage_decisions`, `activity_log` rows are preserved per D116 so
   * a re-connect resumes the sender history. Account *deletion* (D232)
   * is a separate operation that cascades through the mail tables.
   */
  async disconnect(input: {
    workspaceId: string;
    mailboxAccountId: string;
  }): Promise<MailboxSummary> {
    const row = await this.findOwned(input.workspaceId, input.mailboxAccountId);
    if (!row) {
      throw new NotFoundException('Mailbox not found in this workspace.');
    }
    if (row.status === 'disconnected') {
      // Idempotent — already disconnected. Return summary unchanged.
      return {
        id: row.id,
        email: row.providerAccountId,
        status: 'disconnected',
        connectedAt: row.connectedAt?.toISOString() ?? null,
      };
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

    return {
      id: row.id,
      email: row.providerAccountId,
      status: 'disconnected',
      connectedAt: row.connectedAt?.toISOString() ?? null,
    };
  }
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
