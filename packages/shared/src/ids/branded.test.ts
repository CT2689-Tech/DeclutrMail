import { describe, it, expect } from 'vitest';
import {
  asSenderId,
  asMailboxId,
  asUserId,
  asActionId,
  asUndoToken,
  asSenderKey,
  asIdempotencyKey,
} from './branded';

const VALID_UUID = '0e2f6c5e-1234-4abc-8def-0123456789ab';
const VALID_SHA = 'a'.repeat(64);

describe('branded id parsers', () => {
  it.each([
    ['asSenderId', asSenderId],
    ['asMailboxId', asMailboxId],
    ['asUserId', asUserId],
    ['asActionId', asActionId],
    ['asUndoToken', asUndoToken],
  ] as const)('%s accepts valid UUID', (_label, parse) => {
    expect(parse(VALID_UUID)).toBe(VALID_UUID);
  });

  it.each([
    ['asSenderId', asSenderId],
    ['asMailboxId', asMailboxId],
    ['asUserId', asUserId],
    ['asActionId', asActionId],
    ['asUndoToken', asUndoToken],
  ] as const)('%s throws on garbage', (_label, parse) => {
    expect(() => parse('not-a-uuid')).toThrow(/invalid UUID/);
  });

  it('asSenderKey accepts a sha256 hex', () => {
    expect(asSenderKey(VALID_SHA)).toBe(VALID_SHA);
  });

  it('asSenderKey rejects non-hex / wrong length', () => {
    expect(() => asSenderKey('a'.repeat(63))).toThrow(/invalid sha256 hex/);
    expect(() => asSenderKey('g'.repeat(64))).toThrow(/invalid sha256 hex/);
  });

  it('asIdempotencyKey enforces length window', () => {
    expect(() => asIdempotencyKey('short')).toThrow(/8..256/);
    expect(() => asIdempotencyKey('x'.repeat(257))).toThrow(/8..256/);
    expect(asIdempotencyKey('a-valid-idem-key')).toBe('a-valid-idem-key');
  });
});
