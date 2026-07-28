import type { EmailPrefs } from '@declutrmail/shared/contracts';

import { signUnsubscribeToken } from './unsubscribe-token.js';

/**
 * The signed one-click URL for one opt-out-able send (D165).
 *
 * ONE url serves both consumers, deliberately — minting a second token
 * for the visible link would double the credential surface for no gain:
 *   - Gmail POSTs it (RFC 8058 one-click, no user interaction);
 *   - a human clicks it from the body, landing on the read-only GET
 *     confirmation page whose button POSTs the same token.
 *
 * SYSTEM kinds (deletion-scheduled, deletion-receipt) must NOT call
 * this — there is nothing to unsubscribe from, and offering the control
 * on a required account notice is a lie.
 */
export async function unsubscribeUrl(input: {
  userId: string;
  category: keyof EmailPrefs;
  apiUrl: string;
}): Promise<string> {
  const token = await signUnsubscribeToken({
    userId: input.userId,
    category: input.category,
  });
  return `${input.apiUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

/**
 * RFC 8058 headers wrapping an already-minted URL.
 *
 * Both headers are required for Gmail to render its native unsubscribe
 * control: the URL alone yields a mailto-style fallback at best.
 * `List-Unsubscribe-Post` is what promises the endpoint accepts a POST
 * with no user interaction.
 *
 * The header is NOT a substitute for the in-body link (CAN-SPAM
 * §7704(a)(5), GDPR Art. 21(2)) — Gmail only renders the native control
 * when sender reputation is good, and Outlook desktop and most
 * third-party mobile clients render nothing at all. Both ship together.
 */
export function unsubscribeHeadersFor(url: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
