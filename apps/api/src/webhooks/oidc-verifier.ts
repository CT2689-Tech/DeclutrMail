import { createPublicKey, createVerify } from 'node:crypto';

/**
 * Google Pub/Sub OIDC verifier (D229).
 *
 * Implements the full 8-step Pub/Sub OIDC checklist from CLAUDE.md
 * section 2.5. The handler that calls this verifier owns step 7
 * (messageId dedup) and step 8 (historyId monotonic) because those
 * require DB state — every other step is local to this module.
 *
 * Cryptography is intentionally hand-rolled on top of Node's
 * built-in `crypto` (no `jose` / `jsonwebtoken` / `google-auth-library`
 * dependency) so the eight steps are unambiguous in source and the
 * audit by `webhook-security-auditor` can trace each claim to a
 * specific assertion in this file.
 *
 * Step coverage (matches CLAUDE.md section 2.5 numbering exactly):
 *   1. Bearer extraction (extractBearerToken)
 *   2. JWKS fetch + RS256 signature verify (getJwks, verifySignature)
 *   3. iss claim check
 *   4. aud claim check
 *   5. email claim + email_verified check
 *   6. exp + iat check (with clock skew tolerance)
 *   7. messageId dedup — caller's responsibility (DB write)
 *   8. historyId monotonic — caller's responsibility (DB compare)
 *
 * NEVER use `x-goog-authenticated-user-email`. That is a Cloud Run
 * IAM identity header, NOT the Pub/Sub authenticated-push mechanism.
 * Pub/Sub authenticated push uses an OIDC token whose `email` claim
 * identifies the configured service account.
 */

/** Google's published JWKS endpoint (D229 step 2). */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** JWKS cache TTL — 1h. Google rotates keys daily; short TTL is cheap insurance. */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/** Acceptable `iss` values (Google returns both forms historically). */
const ALLOWED_ISSUERS: ReadonlySet<string> = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);

/** Clock-skew tolerance: 60s on both sides of exp/iat. */
const CLOCK_SKEW_S = 60;

/**
 * The minimal claim shape DeclutrMail consumes. Google's OIDC tokens
 * carry more, but we don't trust or use anything outside this list.
 */
export interface PubSubOidcClaims {
  iss: string;
  aud: string;
  email: string;
  email_verified: boolean;
  exp: number; // epoch seconds
  iat: number; // epoch seconds
  sub: string;
  azp?: string;
}

export interface PubSubOidcVerifierConfig {
  /** Expected `aud` claim (env PUBSUB_PUSH_AUDIENCE). */
  audience: string;
  /** Expected `email` claim (env PUBSUB_PUSH_SA_EMAIL). */
  serviceAccountEmail: string;
  /** Optional override for the JWKS fetcher — tests inject a fake. */
  jwksFetcher?: JwksFetcher;
  /** Optional clock override — tests inject a fixed now(). */
  now?: () => number;
}

/** Failure reasons map to a single 401; the kind lets us log discriminated. */
export type OidcVerifyFailure =
  | { ok: false; step: 1; reason: 'missing_authorization_header' }
  | { ok: false; step: 1; reason: 'wrong_scheme' }
  | { ok: false; step: 1; reason: 'malformed_jwt' }
  | { ok: false; step: 2; reason: 'jwks_fetch_failed'; cause: string }
  | { ok: false; step: 2; reason: 'unknown_kid' }
  | { ok: false; step: 2; reason: 'unsupported_alg'; alg: string }
  | { ok: false; step: 2; reason: 'signature_invalid' }
  | { ok: false; step: 3; reason: 'issuer_mismatch'; iss: string }
  | { ok: false; step: 4; reason: 'audience_mismatch'; aud: string }
  | { ok: false; step: 5; reason: 'email_mismatch'; email: string }
  | { ok: false; step: 5; reason: 'email_not_verified' }
  | { ok: false; step: 6; reason: 'expired'; exp: number }
  | { ok: false; step: 6; reason: 'issued_in_future'; iat: number };

export type OidcVerifyResult = { ok: true; claims: PubSubOidcClaims } | OidcVerifyFailure;

/** Decoded JWT shape pre-verification. */
interface DecodedJwt {
  header: { alg: string; kid: string; typ?: string };
  payload: PubSubOidcClaims;
  signingInput: string; // `${b64header}.${b64payload}` — the bytes signed by Google
  signature: Buffer;
}

/** A single JWK from Google's JWKS document. */
interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
  use?: string;
}

/** Fetcher contract — global fetch in prod, an in-memory map in tests. */
export type JwksFetcher = () => Promise<{ keys: Jwk[] }>;

/**
 * Default JWKS fetcher — Node's global fetch against Google's
 * published endpoint. Transport errors surface as `jwks_fetch_failed`
 * rather than uncaught promise rejections (which would 500 instead
 * of 401).
 */
const defaultJwksFetcher: JwksFetcher = async () => {
  const res = await fetch(GOOGLE_JWKS_URL, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`JWKS endpoint returned HTTP ${res.status}`);
  }
  return (await res.json()) as { keys: Jwk[] };
};

/**
 * PubSubOidcVerifier — stateful (holds a JWKS cache) and re-entrant
 * (the cache is read-mostly with a single in-flight refresh).
 *
 * Construct once at module bootstrap; reuse for every webhook
 * request. Tests construct a fresh instance per-test with `now` and
 * `jwksFetcher` overrides so the cache cannot leak across cases.
 */
export class PubSubOidcVerifier {
  private readonly audience: string;
  private readonly serviceAccountEmail: string;
  private readonly fetcher: JwksFetcher;
  private readonly now: () => number;
  /** Cached JWKS keys, keyed by kid for O(1) lookup. */
  private cache: { keys: Map<string, Jwk>; expiresAt: number } | null = null;
  /** De-dupe concurrent refreshes — first caller does the work, others await. */
  private inflight: Promise<Map<string, Jwk>> | null = null;

  constructor(config: PubSubOidcVerifierConfig) {
    if (!config.audience) {
      throw new Error('PubSubOidcVerifier: `audience` is required (env PUBSUB_PUSH_AUDIENCE).');
    }
    if (!config.serviceAccountEmail) {
      throw new Error(
        'PubSubOidcVerifier: `serviceAccountEmail` is required (env PUBSUB_PUSH_SA_EMAIL).',
      );
    }
    this.audience = config.audience;
    this.serviceAccountEmail = config.serviceAccountEmail;
    this.fetcher = config.jwksFetcher ?? defaultJwksFetcher;
    this.now = config.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Run the full local-only portion of OIDC verification (steps 1-6)
   * on a request's Authorization header value. Steps 7 + 8 are the
   * caller's responsibility (they need DB state). Returns either
   * verified claims or a discriminated failure object — the caller
   * maps any failure to HTTP 401.
   */
  async verify(authorizationHeader: string | undefined): Promise<OidcVerifyResult> {
    // Step 1: Bearer extraction.
    const tokenOrFail = extractBearerToken(authorizationHeader);
    if ('ok' in tokenOrFail && tokenOrFail.ok === false) {
      return tokenOrFail;
    }
    if (!('token' in tokenOrFail)) {
      // Defensive — TS narrowing helper; this branch is unreachable.
      return { ok: false, step: 1, reason: 'malformed_jwt' };
    }
    const decodedOrFail = decodeJwt(tokenOrFail.token);
    if ('ok' in decodedOrFail && decodedOrFail.ok === false) {
      return decodedOrFail;
    }
    if (!('header' in decodedOrFail)) {
      return { ok: false, step: 1, reason: 'malformed_jwt' };
    }
    const decoded = decodedOrFail;

    // Step 2: JWKS fetch + RS256 signature verify.
    const sigResult = await this.verifySignature(decoded);
    if (sigResult !== null) {
      return sigResult;
    }

    // Step 3: Issuer.
    if (!ALLOWED_ISSUERS.has(decoded.payload.iss)) {
      return { ok: false, step: 3, reason: 'issuer_mismatch', iss: decoded.payload.iss };
    }

    // Step 4: Audience.
    if (decoded.payload.aud !== this.audience) {
      return { ok: false, step: 4, reason: 'audience_mismatch', aud: decoded.payload.aud };
    }

    // Step 5: Email + email_verified.
    if (decoded.payload.email !== this.serviceAccountEmail) {
      return { ok: false, step: 5, reason: 'email_mismatch', email: decoded.payload.email };
    }
    if (decoded.payload.email_verified !== true) {
      return { ok: false, step: 5, reason: 'email_not_verified' };
    }

    // Step 6: exp + iat.
    const nowSec = this.now();
    if (decoded.payload.exp + CLOCK_SKEW_S <= nowSec) {
      return { ok: false, step: 6, reason: 'expired', exp: decoded.payload.exp };
    }
    if (decoded.payload.iat - CLOCK_SKEW_S > nowSec) {
      return { ok: false, step: 6, reason: 'issued_in_future', iat: decoded.payload.iat };
    }

    return { ok: true, claims: decoded.payload };
  }

  /**
   * Verify the RS256 signature against the kid-matched JWK. Returns
   * `null` on success or a verifier failure on any of: JWKS fetch
   * error, unknown kid, unsupported alg, or signature mismatch.
   *
   * On an unknown kid we force-refresh the cache exactly once — the
   * usual cause is a rotation that happened mid-cache-TTL.
   */
  private async verifySignature(decoded: DecodedJwt): Promise<OidcVerifyFailure | null> {
    if (decoded.header.alg !== 'RS256') {
      return { ok: false, step: 2, reason: 'unsupported_alg', alg: decoded.header.alg };
    }
    let keys: Map<string, Jwk>;
    try {
      keys = await this.getJwks();
    } catch (err) {
      return {
        ok: false,
        step: 2,
        reason: 'jwks_fetch_failed',
        cause: err instanceof Error ? err.message : String(err),
      };
    }
    let jwk = keys.get(decoded.header.kid);
    if (!jwk) {
      this.cache = null;
      try {
        keys = await this.getJwks();
      } catch (err) {
        return {
          ok: false,
          step: 2,
          reason: 'jwks_fetch_failed',
          cause: err instanceof Error ? err.message : String(err),
        };
      }
      jwk = keys.get(decoded.header.kid);
      if (!jwk) {
        return { ok: false, step: 2, reason: 'unknown_kid' };
      }
    }
    if (!jwkVerifiesSignature(jwk, decoded.signingInput, decoded.signature)) {
      return { ok: false, step: 2, reason: 'signature_invalid' };
    }
    return null;
  }

  /**
   * Return the JWKS-by-kid map, fetching + caching if necessary.
   * Concurrent callers during a refresh share the same promise so
   * we never make N parallel JWKS GETs on a webhook surge.
   */
  private async getJwks(): Promise<Map<string, Jwk>> {
    const nowMs = this.now() * 1000;
    if (this.cache && this.cache.expiresAt > nowMs) {
      return this.cache.keys;
    }
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = (async () => {
      try {
        const { keys } = await this.fetcher();
        const map = new Map<string, Jwk>();
        for (const k of keys) {
          if (k.kid) {
            map.set(k.kid, k);
          }
        }
        this.cache = { keys: map, expiresAt: nowMs + JWKS_CACHE_TTL_MS };
        return map;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

// Pure helpers (exported for direct tests of each step).

/** Step 1: parse `Authorization: Bearer <jwt>` (scheme case-insensitive). */
export function extractBearerToken(
  header: string | undefined,
):
  | { token: string }
  | Extract<
      OidcVerifyFailure,
      { step: 1; reason: 'missing_authorization_header' | 'wrong_scheme' }
    > {
  if (!header || header.trim().length === 0) {
    return { ok: false, step: 1, reason: 'missing_authorization_header' };
  }
  const trimmed = header.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match || !match[1]) {
    return { ok: false, step: 1, reason: 'wrong_scheme' };
  }
  return { token: match[1].trim() };
}

/** Decode a compact-JWS JWT into header / payload / signature. */
function decodeJwt(
  token: string,
): DecodedJwt | Extract<OidcVerifyFailure, { step: 1; reason: 'malformed_jwt' }> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, step: 1, reason: 'malformed_jwt' };
  }
  const [b64Header, b64Payload, b64Sig] = parts as [string, string, string];
  try {
    const headerJson = base64UrlDecode(b64Header).toString('utf8');
    const payloadJson = base64UrlDecode(b64Payload).toString('utf8');
    const header = JSON.parse(headerJson) as DecodedJwt['header'];
    const payload = JSON.parse(payloadJson) as PubSubOidcClaims;
    if (!header || typeof header.alg !== 'string' || typeof header.kid !== 'string') {
      return { ok: false, step: 1, reason: 'malformed_jwt' };
    }
    if (
      !payload ||
      typeof payload.iss !== 'string' ||
      typeof payload.aud !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number'
    ) {
      return { ok: false, step: 1, reason: 'malformed_jwt' };
    }
    return {
      header,
      payload,
      signingInput: `${b64Header}.${b64Payload}`,
      signature: base64UrlDecode(b64Sig),
    };
  } catch {
    return { ok: false, step: 1, reason: 'malformed_jwt' };
  }
}

/** RS256 verify against a JWK (n, e). Returns true iff the signature checks. */
function jwkVerifiesSignature(jwk: Jwk, signingInput: string, signature: Buffer): boolean {
  const key = createPublicKey({
    key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
    format: 'jwk',
  });
  const verify = createVerify('RSA-SHA256');
  verify.update(signingInput);
  verify.end();
  return verify.verify(key, signature);
}

/**
 * base64url decode — Node's `Buffer.from(str, 'base64url')` is
 * lenient on padding, but we add padding defensively because the
 * runtime version may have a fast path that requires it.
 */
function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, 'base64url');
}
