// Derivation contract for `senders.id` — see `src/sender-id.ts`.
//
// The property that matters lives in the worker suite ("sender id — the
// handle survives a rebuild"): these guard the algebra that property
// depends on.

import { describe, expect, it } from 'vitest';

import { deriveSenderId } from '../src/sender-id';

// Synthetic, and deliberately unmistakable as such. The first draft of
// this file pasted the founder's REAL `mailbox_accounts.id` and a real
// `senders.id` straight out of a Cloud Run log, into a PUBLIC repo —
// which would have published the only per-mailbox input to the
// derivation under test. Never seed a fixture from production output.
const MAILBOX_A = '00000000-0000-4000-8000-00000000000a';
const MAILBOX_B = '00000000-0000-4000-8000-00000000000b';
// sha256("v1|" + normalized_email) shape — 64 hex chars.
const SENDER_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('deriveSenderId', () => {
  it('is stable across calls — the same pair always yields the same handle', () => {
    expect(deriveSenderId(MAILBOX_A, SENDER_KEY)).toBe(deriveSenderId(MAILBOX_A, SENDER_KEY));
  });

  it('is pinned to a literal, so a derivation change can never be silent', () => {
    // A regenerated expectation would defeat the point of this test:
    // this literal is the promise that ids issued before a refactor
    // still resolve after it. If a change makes this fail, that change
    // reissues every sender handle in every mailbox — which is the
    // exact defect `src/sender-id.ts` exists to prevent.
    expect(deriveSenderId(MAILBOX_A, SENDER_KEY)).toBe('50e62f4d-af27-8a2f-8991-88a8a58196cc');
  });

  it('separates mailboxes — one sender writing to two accounts gets two handles', () => {
    expect(deriveSenderId(MAILBOX_A, SENDER_KEY)).not.toBe(deriveSenderId(MAILBOX_B, SENDER_KEY));
  });

  it('separates senders within a mailbox', () => {
    expect(deriveSenderId(MAILBOX_A, SENDER_KEY)).not.toBe(deriveSenderId(MAILBOX_A, OTHER_KEY));
  });

  it('emits a well-formed UUID so the `uuid` column and every isUuid guard accept it', () => {
    const id = deriveSenderId(MAILBOX_A, SENDER_KEY);
    expect(id).toMatch(UUID_RE);
    // RFC 9562: version nibble 8 (vendor-specific), variant bits 10xx.
    expect(id[14]).toBe('8');
    expect(['8', '9', 'a', 'b']).toContain(id[19]);
  });
});
