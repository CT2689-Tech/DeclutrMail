import { beforeAll, describe, expect, it } from 'vitest';

import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js';

describe('unsubscribe token', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'x'.repeat(32);
  });

  it('round-trips userId and category', async () => {
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    expect(await verifyUnsubscribeToken(token)).toEqual({ userId: 'u-1', category: 'reminders' });
  });

  it('returns null for a tampered token', async () => {
    const token = await signUnsubscribeToken({ userId: 'u-1', category: 'reminders' });
    expect(await verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it('returns null for garbage rather than throwing', async () => {
    expect(await verifyUnsubscribeToken('not-a-jwt')).toBeNull();
    expect(await verifyUnsubscribeToken('')).toBeNull();
  });

  it('returns null for an unknown category', async () => {
    // A token minted for a key that is not an EmailPrefs key must not
    // be honoured — it would flip an arbitrary preference.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_TOKEN_SECRET);
    const rogue = await new SignJWT({ userId: 'u-1', category: 'isAdmin' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);
    expect(await verifyUnsubscribeToken(rogue)).toBeNull();
  });
});
