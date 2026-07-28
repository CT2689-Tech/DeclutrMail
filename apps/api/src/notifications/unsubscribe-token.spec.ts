import { beforeAll, describe, expect, it } from 'vitest';

import { EmailPrefsSchema } from '@declutrmail/shared/contracts';

import {
  OPT_OUT_CATEGORIES,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.js';

describe('unsubscribe token', () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'x'.repeat(32);
  });

  it('round-trips userId and scope', async () => {
    const token = await signUnsubscribeToken({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'all',
    });
    expect(await verifyUnsubscribeToken(token)).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'all',
    });
  });

  it('returns null for a tampered token', async () => {
    const token = await signUnsubscribeToken({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'all',
    });
    expect(await verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it('returns null for garbage rather than throwing', async () => {
    expect(await verifyUnsubscribeToken('not-a-jwt')).toBeNull();
    expect(await verifyUnsubscribeToken('')).toBeNull();
  });

  it('returns null for a non-uuid userId', async () => {
    // users.id is a uuid column — an arbitrary-string claim would make
    // Postgres throw a cast error and turn the uniform 200 into a 500.
    const token = await signUnsubscribeToken({
      userId: 'smoke-placeholder-user',
      scope: 'all',
    });
    expect(await verifyUnsubscribeToken(token)).toBeNull();
  });

  it('still honours a single-category scope', async () => {
    // Tokens never expire, so a granular link minted by a future
    // settings/sequence surface must remain verifiable alongside 'all'.
    const token = await signUnsubscribeToken({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'reminders',
    });
    expect(await verifyUnsubscribeToken(token)).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'reminders',
    });
  });

  it('still honours a LEGACY `category` token from already-delivered mail', async () => {
    // Tokens never expire. Renaming the claim must not strand links
    // sitting in inboxes: they would verify as null, and the uniform
    // 200 would report success while doing nothing — a dead unsubscribe
    // link that looks like it worked. Minted exactly as the pre-rename
    // signer did.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_TOKEN_SECRET);
    const legacy = await new SignJWT({
      userId: '11111111-1111-4111-8111-111111111111',
      category: 'syncComplete',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(secret);

    expect(await verifyUnsubscribeToken(legacy)).toEqual({
      userId: '11111111-1111-4111-8111-111111111111',
      // Mapped to 'all': the control it was minted behind said plainly
      // "Unsubscribe", and this endpoint can only ever turn things OFF.
      scope: 'all',
    });
  });

  it('rejects a legacy token whose category is not a real preference', async () => {
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_TOKEN_SECRET);
    const rogue = await new SignJWT({
      userId: '11111111-1111-4111-8111-111111111111',
      category: 'isAdmin',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);
    expect(await verifyUnsubscribeToken(rogue)).toBeNull();
  });

  it('returns null for an unknown scope', async () => {
    // A token minted for a key that is neither 'all' nor an EmailPrefs
    // key must not be honoured — it would flip an arbitrary preference.
    const { SignJWT } = await import('jose');
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_TOKEN_SECRET);
    const rogue = await new SignJWT({
      userId: '11111111-1111-4111-8111-111111111111',
      scope: 'isAdmin',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret);
    expect(await verifyUnsubscribeToken(rogue)).toBeNull();
  });

  it('covers every EmailPrefs category under "all"', () => {
    // Derived from the schema, never hand-listed: a category added to
    // EmailPrefsSchema must fall under 'all' automatically, or it would
    // keep sending to someone who unsubscribed from everything.
    expect(OPT_OUT_CATEGORIES).toEqual(Object.keys(EmailPrefsSchema.shape));
    expect(OPT_OUT_CATEGORIES.length).toBeGreaterThan(0);
  });
});
