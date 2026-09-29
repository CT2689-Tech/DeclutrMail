import { OAuth2Client, type OAuth2ClientOptions } from 'google-auth-library';

/**
 * Per request to Google, each retry included. Nothing else bounds the
 * library's own calls (code exchange, token refresh, token info, certs),
 * and it retries its token POSTs. A stalled endpoint could otherwise hold
 * an OAuth callback, which awaits `users.watch` and so a refresh, or a
 * sync job until the platform's own timeout. Gmail REST calls set their
 * own ceiling (`REQUEST_TIMEOUT_MS` in gmail-client.service.ts).
 */
export const GOOGLE_TIMEOUT_MS = 10_000;

/** Every `OAuth2Client` the API builds comes from here. */
export function googleOAuthClient(
  options: Pick<OAuth2ClientOptions, 'clientId' | 'clientSecret' | 'redirectUri'>,
): OAuth2Client {
  return new OAuth2Client({ ...options, transporterOptions: { timeout: GOOGLE_TIMEOUT_MS } });
}
