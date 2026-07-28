import { jwtVerify, SignJWT } from 'jose';

import { EmailPrefsSchema, type EmailPrefs } from '@declutrmail/shared/contracts';

/**
 * What one unsubscribe token is entitled to turn off (D165).
 *
 * `'all'` is what every EMAIL ships, and it is the compliance-relevant
 * value: CAN-SPAM §316.5 lets a sender offer a preference menu but
 * requires an option that stops ALL commercial mail, and a footer link
 * labelled plainly "Unsubscribe" is read by users as exactly that. A
 * per-category token that silently left a sibling category running
 * would both break that expectation and earn spam complaints.
 *
 * The single-category variant is retained because these tokens have NO
 * expiry and live in delivered mail forever — a granular control added
 * later (the settings screen, a D126 sequence) must be expressible
 * without invalidating every link already sitting in someone's inbox.
 */
export type UnsubscribeScope = 'all' | keyof EmailPrefs;

/**
 * Derived from the schema, never hand-listed: a category added to
 * `EmailPrefsSchema` must be covered by `'all'` automatically, or it
 * would silently keep sending to someone who unsubscribed from
 * everything.
 */
export const OPT_OUT_CATEGORIES = Object.keys(EmailPrefsSchema.shape) as (keyof EmailPrefs)[];

const VALID_SCOPES = new Set<string>(['all', ...OPT_OUT_CATEGORIES]);

/**
 * `userId` claims must be uuid-shaped: `users.id` is a uuid column, and
 * comparing it against an arbitrary string makes Postgres throw a cast
 * error — turning the controller's uniform 200 into a 500 oracle.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): Uint8Array {
  const raw = process.env.UNSUBSCRIBE_TOKEN_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET must be set and at least 32 characters.');
  }
  return new TextEncoder().encode(raw);
}

/**
 * RFC 8058 one-click unsubscribe token (D165).
 *
 * Gmail POSTs the List-Unsubscribe URL with NO cookies, so the token is
 * the only credential. It is therefore: unguessable (HMAC over a
 * server secret), single-purpose (carries exactly userId + scope),
 * and non-enumerable (verification failures are indistinguishable from
 * one another to the caller — see the controller's uniform 200).
 *
 * No expiry: an unsubscribe link in a two-year-old email must still
 * work. That is the point of the header, and a stale token can only
 * ever turn preferences OFF.
 */
export async function signUnsubscribeToken(input: {
  userId: string;
  scope: UnsubscribeScope;
}): Promise<string> {
  return new SignJWT({ userId: input.userId, scope: input.scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(secret());
}

/**
 * Never throws — every failure is `null` so the caller stays uniform.
 *
 * Accepts the LEGACY `category` claim as well as `scope`. Tokens have
 * no expiry and live in delivered mail forever, so renaming the claim
 * cannot be allowed to strand links already sitting in inboxes: they
 * would verify as `null`, and because the endpoint answers a uniform
 * 200 to avoid being an enumeration oracle, the user would see success
 * and nothing would happen — a dead unsubscribe link that reports
 * itself as working. Legacy tokens map to `'all'` because the control
 * they were minted behind was labelled plainly "Unsubscribe", and that
 * is what a reader clicking it expects; it is also strictly the more
 * protective reading, since this endpoint can only turn preferences
 * OFF.
 */
export async function verifyUnsubscribeToken(
  token: string,
): Promise<{ userId: string; scope: UnsubscribeScope } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = payload.userId;
    if (typeof userId !== 'string' || !UUID_SHAPE.test(userId)) return null;

    const scope = payload.scope;
    if (typeof scope === 'string') {
      return VALID_SCOPES.has(scope) ? { userId, scope: scope as UnsubscribeScope } : null;
    }

    const legacyCategory = payload.category;
    if (typeof legacyCategory === 'string' && VALID_SCOPES.has(legacyCategory)) {
      return { userId, scope: 'all' };
    }
    return null;
  } catch {
    return null;
  }
}
