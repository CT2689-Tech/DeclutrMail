import { jwtVerify, SignJWT } from 'jose';

import { EmailPrefsSchema, type EmailPrefs } from '@declutrmail/shared/contracts';

/**
 * RFC 8058 one-click unsubscribe token (D165).
 *
 * Gmail POSTs the List-Unsubscribe URL with NO cookies, so the token is
 * the only credential. It is therefore: unguessable (HMAC over a
 * server secret), single-purpose (carries exactly userId + category),
 * and non-enumerable (verification failures are indistinguishable from
 * one another to the caller — see the controller's uniform 200).
 *
 * No expiry: an unsubscribe link in a two-year-old email must still
 * work. That is the point of the header, and a stale token can only
 * ever turn a preference OFF.
 */
const VALID_CATEGORIES = new Set(Object.keys(EmailPrefsSchema.shape));

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

export async function signUnsubscribeToken(input: {
  userId: string;
  category: keyof EmailPrefs;
}): Promise<string> {
  return new SignJWT({ userId: input.userId, category: input.category })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .sign(secret());
}

/** Never throws — every failure is `null` so the caller stays uniform. */
export async function verifyUnsubscribeToken(
  token: string,
): Promise<{ userId: string; category: keyof EmailPrefs } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = payload.userId;
    const category = payload.category;
    if (typeof userId !== 'string' || !UUID_SHAPE.test(userId)) return null;
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) return null;
    return { userId, category: category as keyof EmailPrefs };
  } catch {
    return null;
  }
}
