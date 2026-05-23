import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';

/**
 * Test helpers for the OIDC verifier — generate an RSA key pair,
 * export the public side as a JWK, and sign arbitrary JWT claims.
 *
 * These helpers exist ONLY for tests; they never run in production.
 * Pure Node `crypto`, no third-party JWT lib, so the test surface
 * matches the verifier's hand-rolled signature path one-to-one.
 */

export interface TestKey {
  /** The full JWK with `kty`, `n`, `e`, `kid`, `alg`. */
  publicJwk: { kid: string; kty: string; alg: string; n: string; e: string; use?: string };
  /** Sign function — takes header + payload, returns a compact-JWS JWT. */
  signJwt: (header: Record<string, unknown>, payload: Record<string, unknown>) => string;
  privateKey: KeyObject;
}

export function createTestKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: 'jwk' }) as {
    kty: string;
    n: string;
    e: string;
  };
  return {
    publicJwk: { ...publicJwk, kid, alg: 'RS256', use: 'sig' },
    privateKey,
    signJwt: (header, payload) => {
      const fullHeader = { alg: 'RS256', kid, typ: 'JWT', ...header };
      const b64Header = base64UrlEncode(JSON.stringify(fullHeader));
      const b64Payload = base64UrlEncode(JSON.stringify(payload));
      const signingInput = `${b64Header}.${b64Payload}`;
      const signer = createSign('RSA-SHA256');
      signer.update(signingInput);
      signer.end();
      const sig = signer.sign(privateKey);
      return `${signingInput}.${base64UrlEncode(sig)}`;
    },
  };
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/** Standard claims for a healthy Pub/Sub OIDC push, with overrides applied. */
export function pubsubClaims(overrides: Partial<Record<string, unknown>> = {}): Record<
  string,
  unknown
> {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: 'https://api.declutrmail.example/webhooks/gmail/pubsub',
    azp: '1234567890',
    email: 'pubsub-pusher@declutrmail-prod.iam.gserviceaccount.com',
    email_verified: true,
    sub: '1234567890',
    iat: nowSec,
    exp: nowSec + 600,
    ...overrides,
  };
}
