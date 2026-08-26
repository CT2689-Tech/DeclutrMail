import { describe, expect, it } from 'vitest';

import {
  parseSignupAttributionRef,
  resolveFirstTouchRef,
  SIGNUP_ATTRIBUTION_REFS,
  SignupHeardFromPatchSchema,
} from './signup-attribution';

describe('parseSignupAttributionRef', () => {
  it('accepts the allowlisted first-touch channels, trimmed and lowercased', () => {
    for (const ref of SIGNUP_ATTRIBUTION_REFS) {
      expect(parseSignupAttributionRef(ref)).toBe(ref);
      expect(parseSignupAttributionRef(` ${ref.toUpperCase()} `)).toBe(ref);
    }
  });

  it('drops junk, friend/other/skipped, and non-strings — never infers a channel', () => {
    const dropped: unknown[] = [
      'google',
      'accounts.google.com',
      'utm_source=hn',
      'friend',
      'other',
      'skipped',
      'hackernews',
      '',
      '  ',
      1,
      null,
      undefined,
      { ref: 'hn' },
      ['hn'],
    ];
    for (const value of dropped) {
      expect(parseSignupAttributionRef(value), String(value)).toBeUndefined();
    }
  });
});

describe('resolveFirstTouchRef (set-once)', () => {
  it('keeps an earlier hn when a later simulator visit arrives', () => {
    expect(
      resolveFirstTouchRef({
        existing: 'hn',
        queryRef: 'simulator',
        pathname: '/inbox-simulator',
      }),
    ).toBe('hn');
  });

  it('takes an explicit query ref when nothing is captured yet', () => {
    expect(resolveFirstTouchRef({ queryRef: 'ph', pathname: '/inbox-simulator' })).toBe('ph');
    expect(resolveFirstTouchRef({ queryRef: 'hn', pathname: '/' })).toBe('hn');
  });

  it('attributes a bare simulator visit only when the first-touch slot is empty', () => {
    expect(resolveFirstTouchRef({ pathname: '/inbox-simulator' })).toBe('simulator');
    expect(resolveFirstTouchRef({ pathname: '/demo' })).toBe('simulator');
    expect(resolveFirstTouchRef({ existing: 'reddit', pathname: '/inbox-simulator' })).toBe(
      'reddit',
    );
  });

  it('does not invent a channel from a landing path or junk existing values', () => {
    expect(resolveFirstTouchRef({ pathname: '/' })).toBeUndefined();
    expect(resolveFirstTouchRef({ existing: 'google', queryRef: 'x', pathname: '/' })).toBe('x');
    expect(
      resolveFirstTouchRef({ queryRef: 'accounts.google.com', pathname: '/' }),
    ).toBeUndefined();
  });
});

describe('SignupHeardFromPatchSchema', () => {
  it('accepts a known channel or skip without detail', () => {
    expect(SignupHeardFromPatchSchema.parse({ heardFrom: 'hn' })).toEqual({ heardFrom: 'hn' });
    expect(SignupHeardFromPatchSchema.parse({ heardFrom: 'friend' })).toEqual({
      heardFrom: 'friend',
    });
    expect(SignupHeardFromPatchSchema.parse({ heardFrom: 'skipped' })).toEqual({
      heardFrom: 'skipped',
    });
  });

  it('requires trimmed Other detail and rejects empty / oversized text', () => {
    expect(
      SignupHeardFromPatchSchema.parse({ heardFrom: 'other', detail: '  a podcast  ' }),
    ).toEqual({ heardFrom: 'other', detail: 'a podcast' });
    expect(SignupHeardFromPatchSchema.safeParse({ heardFrom: 'other' }).success).toBe(false);
    expect(
      SignupHeardFromPatchSchema.safeParse({ heardFrom: 'other', detail: '   ' }).success,
    ).toBe(false);
    expect(
      SignupHeardFromPatchSchema.safeParse({ heardFrom: 'other', detail: 'x'.repeat(201) }).success,
    ).toBe(false);
  });

  it('rejects detail on a non-other choice and extra keys', () => {
    expect(SignupHeardFromPatchSchema.safeParse({ heardFrom: 'hn', detail: 'nope' }).success).toBe(
      false,
    );
    expect(SignupHeardFromPatchSchema.safeParse({ heardFrom: 'hn', extra: true }).success).toBe(
      false,
    );
    expect(SignupHeardFromPatchSchema.safeParse({ heardFrom: 'simulator' }).success).toBe(true);
  });
});
