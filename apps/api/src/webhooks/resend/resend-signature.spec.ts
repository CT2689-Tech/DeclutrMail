import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RESEND_WEBHOOK_TOLERANCE_SEC, verifyResendSignature } from './resend-signature.js';

/**
 * Standard-Webhooks (svix-style) signature verification tests (D162).
 * The fixtures sign with the same recipe the verifier checks, so a
 * drift in either side breaks the suite.
 */

const RAW_SECRET = Buffer.from('test-secret-32-bytes-aaaaaaaaaaa');
const SECRET = `whsec_${RAW_SECRET.toString('base64')}`;

function sign(id: string, timestampSec: number, body: string, key: Buffer = RAW_SECRET): string {
  const mac = createHmac('sha256', key).update(`${id}.${timestampSec}.${body}`, 'utf8');
  return `v1,${mac.digest('base64')}`;
}

const NOW_MS = 1_765_000_000_000;
const NOW_SEC = Math.floor(NOW_MS / 1_000);
const BODY = '{"type":"email.bounced","data":{"to":["a@b.com"]}}';

function input(overrides: Partial<Parameters<typeof verifyResendSignature>[0]> = {}) {
  return {
    rawBody: Buffer.from(BODY),
    svixId: 'msg_1',
    svixTimestamp: String(NOW_SEC),
    svixSignature: sign('msg_1', NOW_SEC, BODY),
    secret: SECRET,
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe('verifyResendSignature', () => {
  it('accepts a correctly signed payload', () => {
    expect(verifyResendSignature(input())).toEqual({ ok: true });
  });

  it('accepts when ANY space-delimited signature matches (secret rotation)', () => {
    const rotated = `v1,${Buffer.from('garbagegarbagegarbagegarbagegarb').toString('base64')} ${sign('msg_1', NOW_SEC, BODY)}`;
    expect(verifyResendSignature(input({ svixSignature: rotated }))).toEqual({ ok: true });
  });

  it('rejects a tampered body', () => {
    expect(verifyResendSignature(input({ rawBody: Buffer.from(`${BODY} `) }))).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a signature minted with the wrong key', () => {
    const wrongKey = Buffer.from('wrong-secret-32-bytes-bbbbbbbbbb');
    expect(
      verifyResendSignature(input({ svixSignature: sign('msg_1', NOW_SEC, BODY, wrongKey) })),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects missing headers', () => {
    expect(verifyResendSignature(input({ svixId: undefined }))).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(verifyResendSignature(input({ svixTimestamp: undefined }))).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    expect(verifyResendSignature(input({ svixSignature: undefined }))).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
  });

  it('rejects a stale or future timestamp (replay window)', () => {
    const stale = NOW_SEC - RESEND_WEBHOOK_TOLERANCE_SEC - 1;
    expect(
      verifyResendSignature(
        input({ svixTimestamp: String(stale), svixSignature: sign('msg_1', stale, BODY) }),
      ),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });

    const future = NOW_SEC + RESEND_WEBHOOK_TOLERANCE_SEC + 1;
    expect(
      verifyResendSignature(
        input({ svixTimestamp: String(future), svixSignature: sign('msg_1', future, BODY) }),
      ),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects a non-numeric timestamp', () => {
    expect(verifyResendSignature(input({ svixTimestamp: 'soon' }))).toEqual({
      ok: false,
      reason: 'timestamp_invalid',
    });
  });

  it('rejects an empty secret (fail-closed, never pass-by-default)', () => {
    expect(verifyResendSignature(input({ secret: 'whsec_' }))).toEqual({
      ok: false,
      reason: 'malformed_secret',
    });
  });

  it('rejects v0/unknown signature schemes', () => {
    const v0 = sign('msg_1', NOW_SEC, BODY).replace('v1,', 'v0,');
    expect(verifyResendSignature(input({ svixSignature: v0 }))).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });
});
