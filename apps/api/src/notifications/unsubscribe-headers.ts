import type { EmailPrefs } from '@declutrmail/shared/contracts';

import { signUnsubscribeToken } from './unsubscribe-token.js';

/**
 * RFC 8058 headers for one opt-out-able send (D165).
 *
 * Both headers are required for Gmail to render its native unsubscribe
 * control: the URL alone yields a mailto-style fallback at best.
 * `List-Unsubscribe-Post` is what promises the endpoint accepts a POST
 * with no user interaction.
 *
 * SYSTEM kinds (deletion-scheduled, deletion-receipt) must NOT call
 * this — there is nothing to unsubscribe from, and offering the control
 * on a required account notice is a lie.
 */
export async function unsubscribeHeaders(input: {
  userId: string;
  category: keyof EmailPrefs;
  apiUrl: string;
}): Promise<Record<string, string>> {
  const token = await signUnsubscribeToken({
    userId: input.userId,
    category: input.category,
  });
  const url = `${input.apiUrl.replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
