import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Resend webhook signature verification (D162).
 *
 * Resend signs webhooks with the Standard Webhooks scheme (svix-style):
 *
 *   signedContent = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   signature     = base64( HMAC-SHA256( base64decode(secret), signedContent ) )
 *
 * where `secret` is the dashboard value with its `whsec_` prefix
 * stripped. The `svix-signature` header carries one or more
 * space-delimited `v1,<base64>` entries (key rotation); verification
 * passes when ANY entry matches in constant time.
 *
 * Implemented directly on node:crypto (≈30 lines) instead of adding
 * the `svix` dependency — the verification recipe is a stable,
 * documented standard and this keeps the supply-chain surface flat.
 *
 * Fail-closed: every malformed input path returns a typed failure —
 * never a pass-by-default.
 */

/** Max clock skew accepted between the webhook timestamp and now. */
export const RESEND_WEBHOOK_TOLERANCE_SEC = 5 * 60;

export type ResendVerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing_headers'
        | 'malformed_secret'
        | 'timestamp_invalid'
        | 'timestamp_out_of_tolerance'
        | 'signature_mismatch';
    };

export interface ResendVerifyInput {
  /** Raw request body bytes EXACTLY as received (no re-serialization). */
  rawBody: Buffer;
  svixId: string | undefined;
  svixTimestamp: string | undefined;
  svixSignature: string | undefined;
  /** The `whsec_...` value from the Resend dashboard. */
  secret: string;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export function verifyResendSignature(input: ResendVerifyInput): ResendVerifyResult {
  const { svixId, svixTimestamp, svixSignature } = input;
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  let key: Buffer;
  try {
    const base64Secret = input.secret.startsWith('whsec_')
      ? input.secret.slice('whsec_'.length)
      : input.secret;
    key = Buffer.from(base64Secret, 'base64');
    if (key.length === 0) {
      return { ok: false, reason: 'malformed_secret' };
    }
  } catch {
    return { ok: false, reason: 'malformed_secret' };
  }

  // Replay window — reject stale or future-dated deliveries.
  const timestampSec = Number(svixTimestamp);
  if (!Number.isFinite(timestampSec) || !/^\d+$/.test(svixTimestamp)) {
    return { ok: false, reason: 'timestamp_invalid' };
  }
  const nowSec = (input.nowMs ?? Date.now()) / 1_000;
  if (Math.abs(nowSec - timestampSec) > RESEND_WEBHOOK_TOLERANCE_SEC) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${input.rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', key).update(signedContent, 'utf8').digest();

  // `svix-signature` may carry several space-delimited `v1,<sig>`
  // entries during secret rotation; any constant-time match passes.
  for (const entry of svixSignature.split(' ')) {
    const [version, candidateB64] = entry.split(',', 2);
    if (version !== 'v1' || !candidateB64) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(candidateB64, 'base64');
    } catch {
      continue;
    }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true };
    }
  }
  return { ok: false, reason: 'signature_mismatch' };
}
