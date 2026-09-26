import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { type Credentials, OAuth2Client } from 'google-auth-library';

/**
 * Gmail OAuth scopes (D4).
 *
 * `gmail.modify` is the ONLY Gmail scope — it covers both the
 * metadata-only sync (the `q` search relies on it) and later
 * label/archive mutations. `gmail.metadata` is deliberately NOT
 * requested: it would block the `q` search the sync depends on.
 * `openid` + `userinfo.email` identify the connected account.
 */
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const SCOPES = [GMAIL_SCOPE, 'openid', 'https://www.googleapis.com/auth/userinfo.email'];

/** Result of `exchangeCode` — what the orchestrator needs to proceed. */
export interface OAuthExchangeResult {
  email: string;
  refreshToken: string;
}

/**
 * Google finished the consent without granting Gmail (D108).
 *
 * Google's consent screen can finish with the sign-in permissions but
 * not Gmail, so the exchange succeeds with a refresh token that identifies
 * the account but cannot read or change mail. Storing it only defers the
 * failure to the first scan.
 */
export class GmailScopeNotGrantedError extends Error {
  constructor() {
    super('Google did not grant the Gmail scope.');
    this.name = 'GmailScopeNotGrantedError';
  }
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
  private readonly logger = new Logger(GoogleOAuthService.name);

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
   * Exchange the authorization code for tokens, confirm Gmail was
   * granted, verify the id_token, and return `{ email, refreshToken }`
   * for the orchestrator. THIS METHOD WRITES NOTHING — persistence is
   * the orchestrator's job.
   */
  async exchangeCode(code: string): Promise<OAuthExchangeResult> {
    const client = this.oauthClient();
    const { tokens } = await client.getToken(code);

    if (!(await this.gmailGranted(client, tokens))) {
      throw new GmailScopeNotGrantedError();
    }

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

  /**
   * Whether this grant includes Gmail. Google's token response lists the
   * granted scopes. A response without the list is neither a grant nor a
   * refusal, so ask Google's token-info endpoint rather than guess; a
   * failed lookup fails the exchange like any other Google error.
   */
  private async gmailGranted(client: OAuth2Client, tokens: Credentials): Promise<boolean> {
    // Exact entries, not a substring test: `scope` is a space-delimited
    // list of case-sensitive scope strings.
    const listed = tokens.scope?.split(/\s+/).filter(Boolean) ?? [];
    if (listed.length > 0) return listed.includes(GMAIL_SCOPE);

    this.logger.warn('Google listed no granted scopes; checking token info.');
    if (!tokens.access_token) {
      throw new BadRequestException(
        'Google returned no access token — cannot confirm Gmail access.',
      );
    }
    const info = await client.getTokenInfo(tokens.access_token);
    return info.scopes.includes(GMAIL_SCOPE);
  }
}
