import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { mailboxAccounts } from '@declutrmail/db';
import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { MailboxAccountsService } from '../mailboxes/mailbox-accounts.service.js';
import { SyncService } from '../sync/sync.service.js';
import { EmailRaceLostError, UsersService } from '../users/users.service.js';
import { CsrfService } from './csrf.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenCryptoService } from './token-crypto.service.js';
import type { IssuedTokens } from './jwt.service.js';

/**
 * AuthSignupOrchestrator (D205, the documented exception).
 *
 * D204 forbids cross-feature service injection — features communicate
 * via events. THIS class is the explicit exception: it coordinates
 * first-time connect of a Gmail account, which crosses
 *   users → workspaces → mailbox_accounts → provider_sync_state
 * in one atomic unit. Wiring this through events would smear
 * orchestration across four queues and lose transactional integrity.
 *
 * What `connect` does:
 *
 *   1. Find-or-create the user (UsersService.findByEmail; if absent,
 *      bootstrap a workspace + user in a UoW with race recovery via
 *      EmailRaceLostError).
 *   2. Envelope-encrypt the refresh token via TokenCryptoService.
 *   3. Upsert the mailbox_accounts row + mark sync queued in one
 *      transaction so a Redis outage cannot strand the user (see
 *      `provider_sync_state.readiness_status='queued'` + the boot
 *      reconciler in apps/api/src/worker.ts).
 *   4. Best-effort enqueue the BullMQ initial-sync job.
 *   5. Issue a session row + JWT pair via SessionsService.
 *
 * Returns the issued tokens + identifiers the controller needs to set
 * cookies and pick the post-login redirect.
 */
@Injectable()
export class AuthSignupOrchestrator {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly users: UsersService,
    private readonly mailboxes: MailboxAccountsService,
    private readonly sync: SyncService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
  ) {}

  async connect(input: {
    email: string;
    refreshToken: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<{
    tokens: IssuedTokens;
    csrfToken: string;
    user: { id: string; workspaceId: string; email: string };
    mailbox: { id: string };
    isNewSignup: boolean;
  }> {
    const existing = await this.users.findByEmail(input.email);
    const isNewSignup = !existing;
    const { userId, workspaceId } = existing ?? (await this.bootstrapUser(input.email));

    const encrypted = await this.tokenCrypto.encrypt(input.refreshToken);

    const mailboxRow = await this.db.transaction(async (tx) => {
      const row = await this.mailboxes.upsertConnect(tx, {
        workspaceId,
        userId,
        email: input.email,
        encryptedRefreshToken: encrypted.ciphertext,
        dekEncrypted: encrypted.wrappedDek,
        keyVersion: encrypted.keyVersion,
      });
      await this.sync.markQueued(tx, row.id);
      return row;
    });

    // Best-effort BullMQ enqueue — the durable signal is the `queued`
    // row above. Reconciler picks it up if Redis is unreachable.
    await this.sync.schedule(mailboxRow.id);

    const { tokens } = await this.sessions.issue({
      userId,
      workspaceId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });

    return {
      tokens,
      // CSRF token is independently random — the access JWT carrying
      // the jti is HttpOnly, so the FE cannot read it; a separate
      // non-HttpOnly cookie is the canonical double-submit shape.
      csrfToken: this.csrf.issue(),
      user: { id: userId, workspaceId, email: input.email },
      mailbox: { id: mailboxRow.id },
      isNewSignup,
    };
  }

  /**
   * Add a Gmail mailbox to the CURRENT authenticated workspace
   * (Codex review 2026-05-27, finding #2).
   *
   * Unlike `connect`, this method:
   *   - never creates a user or workspace
   *   - never issues session cookies
   *   - rejects the call if the Google account is already connected
   *     to a DIFFERENT workspace (a different DeclutrMail account
   *     already owns it; we will not silently transfer ownership)
   *
   * The current workspace + user come from the controller's
   * authenticated session; the orchestrator trusts the caller.
   */
  async addMailbox(input: {
    currentUserId: string;
    currentWorkspaceId: string;
    email: string;
    refreshToken: string;
  }): Promise<{ mailboxId: string }> {
    // Cross-workspace ownership guard. The (provider, providerAccountId)
    // UNIQUE constraint on mailbox_accounts means each Google account
    // can live on exactly one row — if that row's workspace differs
    // from the caller's, reject before encrypting + upserting.
    const [existing] = await this.db
      .select({
        id: mailboxAccounts.id,
        workspaceId: mailboxAccounts.workspaceId,
      })
      .from(mailboxAccounts)
      .where(
        and(
          eq(mailboxAccounts.provider, 'gmail'),
          eq(mailboxAccounts.providerAccountId, input.email),
        ),
      )
      .limit(1);
    if (existing && existing.workspaceId !== input.currentWorkspaceId) {
      throw new ConflictException({
        code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE',
        message:
          'This Google account is already connected to a different DeclutrMail workspace. ' +
          'Sign in with that account or disconnect it from the other workspace first.',
      });
    }

    const encrypted = await this.tokenCrypto.encrypt(input.refreshToken);
    const mailboxRow = await this.db.transaction(async (tx) => {
      const row = await this.mailboxes.upsertConnect(tx, {
        workspaceId: input.currentWorkspaceId,
        userId: input.currentUserId,
        email: input.email,
        encryptedRefreshToken: encrypted.ciphertext,
        dekEncrypted: encrypted.wrappedDek,
        keyVersion: encrypted.keyVersion,
      });
      await this.sync.markQueued(tx, row.id);
      return row;
    });

    await this.sync.schedule(mailboxRow.id);
    return { mailboxId: mailboxRow.id };
  }

  /**
   * Insert workspace + user in one UoW, with race recovery via the
   * sentinel `EmailRaceLostError`. The unique constraint on
   * `users.email` is the canonical source of truth — both racers
   * proceed, only one wins the user insert, the loser's transaction
   * rolls the orphan workspace back, and the loser re-selects the
   * winner.
   */
  private async bootstrapUser(email: string): Promise<{ userId: string; workspaceId: string }> {
    try {
      return await this.db.transaction((tx) => this.users.insertWorkspaceAndUser(tx, email));
    } catch (err) {
      if (!(err instanceof EmailRaceLostError)) {
        throw err;
      }
    }
    const winner = await this.users.findByEmail(email);
    if (!winner) {
      throw new InternalServerErrorException('Failed to bootstrap user after race recovery.');
    }
    return winner;
  }
}
