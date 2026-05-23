import { describe, expect, it } from 'vitest';

import { PubSubOidcVerifier, extractBearerToken } from '../oidc-verifier.js';
import { createTestKey, pubsubClaims } from './jwt-helpers.js';

/**
 * OIDC verifier unit tests (D229).
 *
 * One test per failure mode — the verifier's contract is that every
 * branch returns a discriminated `OidcVerifyFailure`. The happy path
 * returns verified claims. Together these prove all 6 local steps
 * (1-6) are present and enforced.
 *
 * Steps 7 + 8 (messageId dedup, historyId monotonic) live in
 * `GmailWebhookService` because they need DB state — those are
 * covered by `gmail-webhook.service.spec.ts`.
 */

const AUDIENCE = 'https://api.declutrmail.example/webhooks/gmail/pubsub';
const SA_EMAIL = 'pubsub-pusher@declutrmail-prod.iam.gserviceaccount.com';

function makeVerifier(options: {
  publicJwk: ReturnType<typeof createTestKey>['publicJwk'];
  now?: () => number;
}): PubSubOidcVerifier {
  return new PubSubOidcVerifier({
    audience: AUDIENCE,
    serviceAccountEmail: SA_EMAIL,
    jwksFetcher: async () => ({ keys: [options.publicJwk] }),
    ...(options.now ? { now: options.now } : {}),
  });
}

describe('extractBearerToken', () => {
  it('rejects an undefined header (step 1)', () => {
    const r = extractBearerToken(undefined);
    expect(r).toEqual({ ok: false, step: 1, reason: 'missing_authorization_header' });
  });

  it('rejects an empty header (step 1)', () => {
    const r = extractBearerToken('   ');
    expect(r).toEqual({ ok: false, step: 1, reason: 'missing_authorization_header' });
  });

  it('rejects a non-Bearer scheme (step 1)', () => {
    const r = extractBearerToken('Basic abc');
    expect(r).toEqual({ ok: false, step: 1, reason: 'wrong_scheme' });
  });

  it('extracts a Bearer token', () => {
    const r = extractBearerToken('Bearer abc.def.ghi');
    expect(r).toEqual({ token: 'abc.def.ghi' });
  });

  it('extracts a lowercase "bearer" token (scheme is case-insensitive)', () => {
    const r = extractBearerToken('bearer abc.def.ghi');
    expect(r).toEqual({ token: 'abc.def.ghi' });
  });
});

describe('PubSubOidcVerifier', () => {
  it('throws at construction without an audience', () => {
    expect(() => new PubSubOidcVerifier({ audience: '', serviceAccountEmail: SA_EMAIL })).toThrow(
      /audience/,
    );
  });

  it('throws at construction without a service account email', () => {
    expect(() => new PubSubOidcVerifier({ audience: AUDIENCE, serviceAccountEmail: '' })).toThrow(
      /serviceAccountEmail/,
    );
  });

  it('accepts a valid token (steps 1-6 all pass)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims());

    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.email).toBe(SA_EMAIL);
      expect(result.claims.aud).toBe(AUDIENCE);
    }
  });

  it('rejects a missing Authorization header (step 1)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const result = await verifier.verify(undefined);
    expect(result).toEqual({ ok: false, step: 1, reason: 'missing_authorization_header' });
  });

  it('rejects a malformed JWT (step 1)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const result = await verifier.verify('Bearer not-a-jwt');
    expect(result).toEqual({ ok: false, step: 1, reason: 'malformed_jwt' });
  });

  it('rejects a non-RS256 alg (step 2)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({ alg: 'HS256' }, pubsubClaims());
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 2) {
      expect(result.reason).toBe('unsupported_alg');
    }
  });

  it('rejects an unknown kid even after a forced refresh (step 2)', async () => {
    const key = createTestKey('signing-kid');
    const otherKey = createTestKey('cache-only-kid');
    // The verifier sees only `otherKey`, but the JWT is signed by `key`.
    const verifier = new PubSubOidcVerifier({
      audience: AUDIENCE,
      serviceAccountEmail: SA_EMAIL,
      jwksFetcher: async () => ({ keys: [otherKey.publicJwk] }),
    });
    const jwt = key.signJwt({}, pubsubClaims());
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 2) {
      expect(result.reason).toBe('unknown_kid');
    }
  });

  it('rejects a tampered signature (step 2)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims());
    // Flip a byte in the signature segment.
    const parts = jwt.split('.');
    const sig = Buffer.from(parts[2]!, 'base64url');
    sig[0] = (sig[0]! ^ 0xff) & 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`;
    const result = await verifier.verify(`Bearer ${tampered}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 2) {
      expect(result.reason).toBe('signature_invalid');
    }
  });

  it('rejects an issuer mismatch (step 3)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims({ iss: 'https://evil.example' }));
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 3) {
      expect(result.reason).toBe('issuer_mismatch');
    }
  });

  it('accepts both Google issuer forms (step 3)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt1 = key.signJwt({}, pubsubClaims({ iss: 'https://accounts.google.com' }));
    const jwt2 = key.signJwt({}, pubsubClaims({ iss: 'accounts.google.com' }));
    expect((await verifier.verify(`Bearer ${jwt1}`)).ok).toBe(true);
    expect((await verifier.verify(`Bearer ${jwt2}`)).ok).toBe(true);
  });

  it('rejects an audience mismatch (step 4)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims({ aud: 'https://other.example' }));
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 4) {
      expect(result.reason).toBe('audience_mismatch');
    }
  });

  it('rejects a wrong email (step 5)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims({ email: 'attacker@evil.example' }));
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 5) {
      expect(result.reason).toBe('email_mismatch');
    }
  });

  it('rejects email_verified=false (step 5)', async () => {
    const key = createTestKey('test-kid-1');
    const verifier = makeVerifier({ publicJwk: key.publicJwk });
    const jwt = key.signJwt({}, pubsubClaims({ email_verified: false }));
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 5) {
      expect(result.reason).toBe('email_not_verified');
    }
  });

  it('rejects an expired token (step 6)', async () => {
    const key = createTestKey('test-kid-1');
    const nowSec = Math.floor(Date.now() / 1000);
    const verifier = makeVerifier({ publicJwk: key.publicJwk, now: () => nowSec });
    const jwt = key.signJwt(
      {},
      pubsubClaims({ iat: nowSec - 1000, exp: nowSec - 100 }),
    );
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 6) {
      expect(result.reason).toBe('expired');
    }
  });

  it('rejects a token issued in the future beyond skew (step 6)', async () => {
    const key = createTestKey('test-kid-1');
    const nowSec = Math.floor(Date.now() / 1000);
    const verifier = makeVerifier({ publicJwk: key.publicJwk, now: () => nowSec });
    const jwt = key.signJwt(
      {},
      pubsubClaims({ iat: nowSec + 3600, exp: nowSec + 4200 }),
    );
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(false);
    if (!result.ok && result.step === 6) {
      expect(result.reason).toBe('issued_in_future');
    }
  });

  it('tolerates a small clock skew on exp (step 6)', async () => {
    const key = createTestKey('test-kid-1');
    const nowSec = Math.floor(Date.now() / 1000);
    const verifier = makeVerifier({ publicJwk: key.publicJwk, now: () => nowSec });
    // exp is 30s in the past — inside the 60s skew window.
    const jwt = key.signJwt({}, pubsubClaims({ iat: nowSec - 600, exp: nowSec - 30 }));
    const result = await verifier.verify(`Bearer ${jwt}`);
    expect(result.ok).toBe(true);
  });

  it('caches JWKS — fetcher is called once across multiple verifies', async () => {
    const key = createTestKey('test-kid-1');
    let fetchCount = 0;
    const verifier = new PubSubOidcVerifier({
      audience: AUDIENCE,
      serviceAccountEmail: SA_EMAIL,
      jwksFetcher: async () => {
        fetchCount++;
        return { keys: [key.publicJwk] };
      },
    });
    for (let i = 0; i < 5; i++) {
      const jwt = key.signJwt({}, pubsubClaims());
      const result = await verifier.verify(`Bearer ${jwt}`);
      expect(result.ok).toBe(true);
    }
    expect(fetchCount).toBe(1);
  });

  it('handles JWKS rotation — refetches once on unknown kid then succeeds', async () => {
    const oldKey = createTestKey('old-kid');
    const newKey = createTestKey('new-kid');
    let fetchCount = 0;
    const verifier = new PubSubOidcVerifier({
      audience: AUDIENCE,
      serviceAccountEmail: SA_EMAIL,
      jwksFetcher: async () => {
        fetchCount++;
        // First call returns old key; subsequent calls return new key.
        return { keys: [fetchCount === 1 ? oldKey.publicJwk : newKey.publicJwk] };
      },
    });
    // Prime cache with old key.
    const oldJwt = oldKey.signJwt({}, pubsubClaims());
    expect((await verifier.verify(`Bearer ${oldJwt}`)).ok).toBe(true);
    expect(fetchCount).toBe(1);

    // New JWT signed by new key — verifier sees unknown kid, refetches, succeeds.
    const newJwt = newKey.signJwt({}, pubsubClaims());
    const result = await verifier.verify(`Bearer ${newJwt}`);
    expect(result.ok).toBe(true);
    expect(fetchCount).toBe(2);
  });
});
