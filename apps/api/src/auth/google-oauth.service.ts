import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { mailboxAccounts, users, workspaces } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
import { SyncService } from '../sync/sync.service.js';
import { TokenCryptoService } from './token-crypto.service.js';

/**
 * Gmail OAuth scopes (D4).
 *
 * `gmail.modify` is the ONLY Gmail scope — it covers both the
 * metadata-only sync (the `q` search relies on it) and later
 * label/archive mutations. `gmail.metadata` is deliberately NOT
 * requested: it would block the `q` search the sync depends on.
 * `openid` + `userinfo.email` identify the connected account.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** What a completed OAuth connect returns to the controller. */
export interface ConnectResult {
  mailboxAccountId: string;
  email: string;
}

/**
 * Thrown inside the bootstrap transaction when a concurrent same-email
 * connect won the `users.email` unique constraint. Throwing rolls the
 * transaction back (undoing the orphan workspace insert); the caller
 * catches it and re-selects the winner's user row.
 */
class EmailRaceLostError extends Error {}

/**
 * GoogleOAuthService — drives the Gmail OAuth connect flow (D4).
 *
 * `getConsentUrl` builds the Google consent URL. `handleCallback`
 * exchanges the authorization code, encrypts the refresh token via
 * envelope encryption (D14), and persists a `mailbox_accounts` row.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(
    private readonly tokenCrypto: TokenCryptoService,
    private readonly sync: SyncService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /** Build a fresh OAuth2Client from env config. */
  private oauthClient(): OAuth2Client {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      throw new InternalServerErrorException(
        'Google OAuth is not configured: set GOOGLE_CLIENT_ID, ' +
          'GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI — see .env.example.',
      );
    }
    return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  }

  /**
   * The Google consent-screen URL the user is redirected to. `state` is
   * the CSRF nonce the controller also stores in an httpOnly cookie;
   * Google echoes it back to /callback for verification.
   */
  getConsentUrl(state: string): string {
    return this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });
  }

  /**
   * Exchange the authorization code, encrypt the refresh token, and
   * persist the connected Gmail account.
   */
  async handleCallback(code: string): Promise<ConnectResult> {
    const client = this.oauthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'Google did not return a refresh token — the account may already ' +
          'be connected; re-consent with prompt=consent is required.',
      );
    }
    if (!tokens.id_token) {
      throw new BadRequestException(
        'Google did not return an id_token — cannot identify the account.',
      );
    }

    const { GOOGLE_CLIENT_ID } = process.env;
    if (!GOOGLE_CLIENT_ID) {
      throw new InternalServerErrorException(
        'Google OAuth is not configured: set GOOGLE_CLIENT_ID — see .env.example.',
      );
    }
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const email = ticket.getPayload()?.email;
    if (!email) {
      throw new BadRequestException(
        'id_token carried no email claim — cannot identify the account.',
      );
    }

    const encrypted = await this.tokenCrypto.encrypt(tokens.refresh_token);

    // PR-B bootstrap: real onboarding/session is D109/D224. Until those
    // land there is no auth layer, so find-or-create a workspace + user
    // keyed on the connected Gmail address to satisfy the NOT NULL FKs.
    const { userId, workspaceId } = await this.findOrCreateUser(email);

    // Mailbox persistence + sync scheduling are split into two phases so
    // there is ONE scheduling implementation (`sync.service`) shared
    // with the worker's periodic reconciler (Codex adversarial review
    // iter 5, 2026-05-22):
    //
    //   1. DB-only mailbox upsert. The OAuth refresh token is single-
    //      use, so it MUST land before we touch a queue that may fail.
    //   2. `sync.enqueueInitialSync` — writes the durable `queued` row,
    //      then best-effort enqueues. Redis outages don't strand the
    //      user: the worker's reconciler picks the row up on its next
    //      tick.
    const [row] = await this.db
      .insert(mailboxAccounts)
      .values({
        workspaceId,
        userId,
        provider: 'gmail',
        providerAccountId: email,
        encryptedRefreshToken: encrypted.ciphertext,
        dekEncrypted: encrypted.wrappedDek,
        keyVersion: encrypted.keyVersion,
        connectedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [mailboxAccounts.provider, mailboxAccounts.providerAccountId],
        set: {
          encryptedRefreshToken: encrypted.ciphertext,
          dekEncrypted: encrypted.wrappedDek,
          keyVersion: encrypted.keyVersion,
          connectedAt: new Date(),
          status: 'active',
        },
      })
      .returning({ id: mailboxAccounts.id });

    if (!row) {
      throw new InternalServerErrorException('Failed to persist the mailbox account.');
    }

    // Delegates to the single scheduling impl in `SyncService` — writes
    // the durable `queued` row + best-effort enqueue. Connect never
    // fails on a queue outage.
    await this.sync.enqueueInitialSync(row.id);

    return { mailboxAccountId: row.id, email };
  }

  /** Find a user by email (citext), or bootstrap a workspace + user. */
  private async findOrCreateUser(email: string): Promise<{ userId: string; workspaceId: string }> {
    const existing = await this.lookupUser(email);
    if (existing) {
      return existing;
    }

    // First-time connect. The workspace + user inserts run in ONE
    // transaction so a lost same-email race leaves NO orphan workspace:
    // `users.email` has a unique index (`users_email_uniq`); the loser's
    // onConflictDoNothing insert returns no row, we throw, the tx rolls
    // back, and the workspace insert is undone with it. Full
    // Idempotency-Key handling is D205's AuthSignupOrchestrator scope.
    try {
      return await this.db.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(workspaces)
          .values({ name: `${email}'s workspace` })
          .returning({ id: workspaces.id });
        if (!workspace) {
          throw new InternalServerErrorException('Failed to bootstrap a workspace.');
        }

        const [user] = await tx
          .insert(users)
          .values({ workspaceId: workspace.id, email })
          .onConflictDoNothing({ target: users.email })
          .returning({ id: users.id });
        if (!user) {
          // Lost the race — roll the workspace insert back.
          throw new EmailRaceLostError();
        }
        return { userId: user.id, workspaceId: workspace.id };
      });
    } catch (err) {
      if (!(err instanceof EmailRaceLostError)) {
        throw err;
      }
    }

    // Race lost: the winner's user row now exists — re-select it.
    const winner = await this.lookupUser(email);
    if (!winner) {
      throw new InternalServerErrorException('Failed to bootstrap a user.');
    }
    return winner;
  }

  /** Select an existing user + its workspace by email, or null. */
  private async lookupUser(email: string): Promise<{ userId: string; workspaceId: string } | null> {
    const [row] = await this.db
      .select({ id: users.id, workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row ? { userId: row.id, workspaceId: row.workspaceId } : null;
  }
}
