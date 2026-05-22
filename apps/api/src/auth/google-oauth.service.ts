import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { mailboxAccounts, users, workspaces } from '@declutrmail/db';

import { DRIZZLE, type DrizzleDb } from '../db/db.module.js';
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
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
  ) {}

  /** Build a fresh OAuth2Client from env config. */
  private oauthClient(): OAuth2Client {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      throw new Error(
        'Google OAuth is not configured: set GOOGLE_CLIENT_ID, ' +
          'GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI — see .env.example.',
      );
    }
    return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
  }

  /** The Google consent-screen URL the user is redirected to. */
  getConsentUrl(): string {
    return this.oauthClient().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
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
      throw new Error(
        'Google did not return a refresh token — the account may already ' +
          'be connected; re-consent with prompt=consent is required.',
      );
    }
    if (!tokens.id_token) {
      throw new Error('Google did not return an id_token — cannot identify the account.');
    }

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token });
    const email = ticket.getPayload()?.email;
    if (!email) {
      throw new Error('id_token carried no email claim — cannot identify the account.');
    }

    const encrypted = await this.tokenCrypto.encrypt(tokens.refresh_token);

    // PR-B bootstrap: real onboarding/session is D109/D224. Until those
    // land there is no auth layer, so find-or-create a workspace + user
    // keyed on the connected Gmail address to satisfy the NOT NULL FKs.
    const { userId, workspaceId } = await this.findOrCreateUser(email);

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
      .returning({ id: mailboxAccounts.id });

    if (!row) {
      throw new Error('Failed to persist the mailbox account.');
    }

    return { mailboxAccountId: row.id, email };
  }

  /** Find a user by email (citext), or bootstrap a workspace + user. */
  private async findOrCreateUser(email: string): Promise<{ userId: string; workspaceId: string }> {
    const existing = await this.db
      .select({ id: users.id, workspaceId: users.workspaceId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existing[0]) {
      return { userId: existing[0].id, workspaceId: existing[0].workspaceId };
    }

    const [workspace] = await this.db
      .insert(workspaces)
      .values({ name: `${email}'s workspace` })
      .returning({ id: workspaces.id });
    if (!workspace) {
      throw new Error('Failed to bootstrap a workspace.');
    }

    const [user] = await this.db
      .insert(users)
      .values({ workspaceId: workspace.id, email })
      .returning({ id: users.id });
    if (!user) {
      throw new Error('Failed to bootstrap a user.');
    }
    return { userId: user.id, workspaceId: workspace.id };
  }
}
