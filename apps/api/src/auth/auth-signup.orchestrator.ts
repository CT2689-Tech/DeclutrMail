import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import {
  ERROR_CODES,
  type ErrorCode,
  type SignupAttributionRef,
} from '@declutrmail/shared/contracts';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { GmailWatchService } from '../mailboxes/gmail-watch.service.js';
import {
  canonicalizeGmailProviderAccountId,
  MailboxAccountsService,
} from '../mailboxes/mailbox-accounts.service.js';
import { SyncService } from '../sync/sync.service.js';
import { EmailRaceLostError, UsersService } from '../users/users.service.js';
import { BetaGateDeniedError, betaGateAllowsSignup } from './beta-gate.js';
import { CsrfService } from './csrf.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenCryptoService, type EnvelopeCiphertext } from './token-crypto.service.js';
import type { IssuedTokens } from './jwt.service.js';

interface ConnectIdentity {
  userId: string;
  workspaceId: string;
}

interface PersistedConnect extends ConnectIdentity {
  mailboxId: string;
  isNewSignup: boolean;
  /** What the connect decided for sync — see `SyncService.markConnected`. */
  syncIntent: ConnectSyncIntent;
}

type ConnectSyncIntent = Awaited<ReturnType<SyncService['markConnected']>>;

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
 *   1. Resolve an existing primary/secondary identity. If absent,
 *      bootstrap workspace + user + mailbox + sync state in one UoW;
 *      users.email and provider-identity losers re-resolve the winner.
 *   2. Envelope-encrypt the refresh token via TokenCryptoService.
 *   3. For returning identities, upsert the mailbox_accounts row and
 *      record the sync intent in one transaction (`markConnected`): a
 *      mailbox that is already synced stays `ready`; anything else is
 *      marked `queued` so a Redis outage cannot strand the user (see
 *      `provider_sync_state.readiness_status='queued'` + the boot
 *      reconciler in apps/api/src/worker.ts).
 *   4. Best-effort enqueue: the initial-sync job for a queued mailbox,
 *      an incremental catch-up for one that stayed ready.
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
    private readonly gmailWatch: GmailWatchService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly sessions: SessionsService,
    private readonly csrf: CsrfService,
  ) {}

  async connect(input: {
    email: string;
    refreshToken: string;
    ipAddress: string | null;
    userAgent: string | null;
    signupAttributionRef?: SignupAttributionRef;
  }): Promise<{
    tokens: IssuedTokens;
    csrfToken: string;
    user: { id: string; workspaceId: string; email: string };
    mailbox: { id: string };
    isNewSignup: boolean;
  }> {
    const email = canonicalizeGmailProviderAccountId(input.email);
    // Identity resolution (Option 1 — "login follows mailbox").
    //
    //   1. A user already owns this email → use their workspace
    //      (the normal returning-primary login).
    //   2. No user, but this Gmail was connected as a SECONDARY
    //      mailbox under another account → resolve the session into
    //      that mailbox's HOME workspace + owner. Logging in with a
    //      secondary email then lands you in the workspace that holds
    //      all your mailboxes, rather than bootstrapping an orphan
    //      empty one (the bug Codex/founder smoke surfaced 2026-05-27).
    //   3. Neither → brand-new signup; bootstrap a workspace + user.
    const existingUser = await this.users.findByEmail(email);
    let identity: ConnectIdentity | null = null;
    if (existingUser) {
      identity = existingUser;
    } else {
      const existingMailbox = await this.mailboxes.findByProviderEmail(email);
      if (existingMailbox) {
        identity = existingMailbox;
      } else {
        // Private-beta invite gate (F7). Branches 1–2 above are
        // existing users and always pass; ONLY a brand-new signup is
        // gated, and the denial fires BEFORE any side effect — no
        // workspace/user bootstrap, no token encryption, no mailbox
        // row, no session. The controller turns the sentinel into a
        // redirect to the public /beta waitlist page.
        if (!betaGateAllowsSignup(email)) {
          throw new BetaGateDeniedError();
        }
      }
    }

    const encrypted = await this.tokenCrypto.encrypt(input.refreshToken);
    const persisted = identity
      ? await this.persistResolvedConnect(identity, email, encrypted, false)
      : await this.bootstrapAndPersistConnect(email, encrypted, input.signupAttributionRef);
    const { userId, workspaceId, mailboxId, isNewSignup, syncIntent } = persisted;

    // Land the user on the mailbox they just authenticated with — set
    // it as the active-mailbox preference so the account switcher +
    // CurrentMailboxGuard resolve to it. Without this, logging in with
    // a secondary email would resolve the workspace correctly but show
    // the primary mailbox as active.
    await this.users.patchPreferences(userId, { activeMailboxId: mailboxId });

    await this.scheduleAfterConnect(mailboxId, syncIntent);

    // `users.watch` on connect AND reconnect (D8/D225/D229 — both the
    // first-time connect and a post-disconnect reconnect flow through
    // here; `upsertConnect` stores the fresh token either way).
    // Best-effort + non-throwing: a Gmail hiccup must not fail the
    // OAuth redirect, and the 6h WatchRenewalWorker heals a miss.
    await this.gmailWatch.watchMailbox(mailboxId);

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
      user: { id: userId, workspaceId, email },
      mailbox: { id: mailboxId },
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
    const email = canonicalizeGmailProviderAccountId(input.email);
    // Cross-workspace ownership guard. The (provider, providerAccountId)
    // UNIQUE constraint on mailbox_accounts means each Google account
    // can live on exactly one row — if that row's workspace differs
    // from the caller's, reject before encrypting + upserting.
    const existing = await this.mailboxes.findByProviderEmail(email);
    if (existing && existing.workspaceId !== input.currentWorkspaceId) {
      throw new ConflictException({
        code: 'MAILBOX_OWNED_BY_OTHER_WORKSPACE' satisfies ErrorCode,
        message: ERROR_CODES.MAILBOX_OWNED_BY_OTHER_WORKSPACE.message,
      });
    }

    const encrypted = await this.tokenCrypto.encrypt(input.refreshToken);
    const mailboxRow = await this.db.transaction(async (tx) => {
      const row = await this.mailboxes.upsertConnect(tx, {
        workspaceId: input.currentWorkspaceId,
        userId: input.currentUserId,
        email,
        encryptedRefreshToken: encrypted.ciphertext,
        dekEncrypted: encrypted.wrappedDek,
        keyVersion: encrypted.keyVersion,
      });
      const syncIntent = await this.sync.markConnected(tx, row.id, { wasActive: row.wasActive });
      return { id: row.id, syncIntent };
    });

    // Switch-and-gate (D115, D109): make the just-connected mailbox the
    // active one so `CurrentMailboxGuard` resolves to it and the user
    // lands on ITS sync gate. Mirrors the login flow (`connect`), which
    // sets the authenticated mailbox active for the same reason — without
    // it a second connected mailbox leaves two active mailboxes with no
    // preference, so every read throws 409 SELECT_MAILBOX.
    await this.users.patchPreferences(input.currentUserId, {
      activeMailboxId: mailboxRow.id,
    });

    await this.scheduleAfterConnect(mailboxRow.id, mailboxRow.syncIntent);

    // `users.watch` for the added/reconnected mailbox — same
    // best-effort contract as `connect` above (D8/D225/D229).
    await this.gmailWatch.watchMailbox(mailboxRow.id);
    return { mailboxId: mailboxRow.id };
  }

  /** Persist mailbox credentials + durable sync readiness as one UoW. */
  private async persistMailbox(
    identity: ConnectIdentity,
    email: string,
    encrypted: EnvelopeCiphertext,
  ): Promise<{ id: string; syncIntent: ConnectSyncIntent }> {
    return this.db.transaction(async (tx) => {
      const row = await this.mailboxes.upsertConnect(tx, {
        workspaceId: identity.workspaceId,
        userId: identity.userId,
        email,
        encryptedRefreshToken: encrypted.ciphertext,
        dekEncrypted: encrypted.wrappedDek,
        keyVersion: encrypted.keyVersion,
      });
      const syncIntent = await this.sync.markConnected(tx, row.id, { wasActive: row.wasActive });
      return { id: row.id, syncIntent };
    });
  }

  /**
   * Post-commit, best-effort (the durable signal is the row written in
   * the connect transaction; the reconciler covers a Redis outage).
   *
   * `queued` → the initial-sync job. `force`: we just stored a fresh
   * OAuth token, so supersede any stale pending job (e.g. a reconnect's
   * pre-disconnect leftover) that would fail on the old token and flip
   * readiness to `failed`.
   *
   * `kept_ready` → one incremental catch-up, so a returning user's
   * mailbox is current without re-scanning and re-scoring it.
   */
  private async scheduleAfterConnect(
    mailboxId: string,
    syncIntent: ConnectSyncIntent,
  ): Promise<void> {
    if (syncIntent === 'queued') {
      await this.sync.schedule(mailboxId, { force: true });
    } else {
      await this.sync.scheduleCatchUp(mailboxId);
    }
  }

  /**
   * Persist for an already-resolved identity. The DB ownership guard can
   * still beat the earlier read; in that case, follow the provider row's
   * canonical home workspace. This also heals historical orphan users:
   * their email row may win the first lookup, but login still resolves to
   * the workspace that actually owns the Gmail identity.
   */
  private async persistResolvedConnect(
    identity: ConnectIdentity,
    email: string,
    encrypted: EnvelopeCiphertext,
    isNewSignup: boolean,
  ): Promise<PersistedConnect> {
    try {
      const mailbox = await this.persistMailbox(identity, email, encrypted);
      return { ...identity, mailboxId: mailbox.id, isNewSignup, syncIntent: mailbox.syncIntent };
    } catch (err) {
      if (!isMailboxOwnershipConflict(err)) {
        throw err;
      }
    }

    const winner = await this.mailboxes.findByProviderEmail(email);
    if (!winner) {
      throw new InternalServerErrorException(
        'Failed to resolve mailbox owner after provider-identity race.',
      );
    }
    const mailbox = await this.persistMailbox(winner, email, encrypted);
    return {
      userId: winner.userId,
      workspaceId: winner.workspaceId,
      mailboxId: mailbox.id,
      isNewSignup: false,
      syncIntent: mailbox.syncIntent,
    };
  }

  /**
   * Bootstrap workspace + user + mailbox + sync readiness in one UoW.
   * If either global identity constraint loses, the entire provisional
   * workspace rolls back before we re-resolve and persist into the winner.
   */
  private async bootstrapAndPersistConnect(
    email: string,
    encrypted: EnvelopeCiphertext,
    signupAttributionRef?: SignupAttributionRef,
  ): Promise<PersistedConnect> {
    try {
      return await this.db.transaction(async (tx) => {
        const identity = signupAttributionRef
          ? await this.users.insertWorkspaceAndUser(tx, email, signupAttributionRef)
          : await this.users.insertWorkspaceAndUser(tx, email);
        const mailbox = await this.mailboxes.upsertConnect(tx, {
          workspaceId: identity.workspaceId,
          userId: identity.userId,
          email,
          encryptedRefreshToken: encrypted.ciphertext,
          dekEncrypted: encrypted.wrappedDek,
          keyVersion: encrypted.keyVersion,
        });
        const syncIntent = await this.sync.markConnected(tx, mailbox.id, {
          wasActive: mailbox.wasActive,
        });
        return { ...identity, mailboxId: mailbox.id, isNewSignup: true, syncIntent };
      });
    } catch (err) {
      if (!(err instanceof EmailRaceLostError) && !isMailboxOwnershipConflict(err)) {
        throw err;
      }

      // Provider identity is the canonical destination. Check it before
      // users.email so a historical/provisional user can never mask the
      // workspace whose mailbox row won the race.
      const mailboxWinner = await this.mailboxes.findByProviderEmail(email);
      if (mailboxWinner) {
        return this.persistResolvedConnect(
          mailboxWinner,
          email,
          encrypted,
          err instanceof EmailRaceLostError,
        );
      }

      // A users.email winner may exist without its mailbox only when the
      // competing transaction used a legacy/non-connect bootstrap path.
      const userWinner = await this.users.findByEmail(email);
      if (userWinner) {
        return this.persistResolvedConnect(userWinner, email, encrypted, true);
      }

      throw new InternalServerErrorException('Failed to resolve identity after signup race.');
    }
  }
}

/** Narrow a Nest conflict to the provider-identity ownership sentinel. */
function isMailboxOwnershipConflict(error: unknown): error is ConflictException {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    response.code === 'MAILBOX_OWNED_BY_OTHER_WORKSPACE'
  );
}
