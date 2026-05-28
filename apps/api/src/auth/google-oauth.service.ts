import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

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

/** Result of `exchangeCode` — what the orchestrator needs to proceed. */
export interface OAuthExchangeResult {
  email: string;
  refreshToken: string;
}

/**
 * GoogleOAuthService — thin wrapper around the Google API surface
 * (consent URL, code exchange, id_token verify). After the D205
 * restructure, this service owns NO database writes — those moved to
 * `AuthSignupOrchestrator`, `UsersService`, and
 * `MailboxAccountsService`. The split keeps each feature module to
 * its own table per D204.
 */
@Injectable()
export class GoogleOAuthService {
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
   * The Google consent-screen URL the user is redirected to. `state`
   * is the CSRF nonce the controller stores in an httpOnly cookie;
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
   * Exchange the authorization code for tokens, verify the id_token,
   * and return `{ email, refreshToken }` for the orchestrator. THIS
   * METHOD WRITES NOTHING — persistence is the orchestrator's job.
   */
  async exchangeCode(code: string): Promise<OAuthExchangeResult> {
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

    return { email, refreshToken: tokens.refresh_token };
  }
}
