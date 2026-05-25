import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { deriveSenderKey, emailDomain, normalizeEmail, parseFromHeader } from './sender-key.js';

/**
 * Sender-key derivation tests (D12 / ADR-0011).
 *
 * D12 is a hard contract — `privacy-auditor` and the senders aggregate
 * both depend on the exact formula `sha256("v1|" + normalized_email)`.
 */
describe('deriveSenderKey (D12)', () => {
  it('matches the locked formula sha256("v1|" + normalized_email)', () => {
    // Anchored to an independently-computed value — guards against a
    // formula change that a recomputed reference would not catch.
    expect(deriveSenderKey('jane@example.com')).toBe(
      '3413d8ec4901c8736284171bcbce403fd66a41d4e00b1c0221664c92f77c7f58',
    );
  });

  it('agrees with a reference sha256 of the prefixed normalized address', () => {
    const reference = createHash('sha256').update('v1|jane@example.com').digest('hex');
    expect(deriveSenderKey('jane@example.com')).toBe(reference);
  });

  it('is case- and whitespace-insensitive (normalization)', () => {
    const canonical = deriveSenderKey('jane@example.com');
    expect(deriveSenderKey('  Jane@Example.COM  ')).toBe(canonical);
    expect(deriveSenderKey('JANE@EXAMPLE.COM')).toBe(canonical);
  });

  it('is versioned — the "v1|" prefix changes the hash', () => {
    const unprefixed = createHash('sha256').update('jane@example.com').digest('hex');
    expect(deriveSenderKey('jane@example.com')).not.toBe(unprefixed);
  });

  it('produces 64-char lowercase hex', () => {
    expect(deriveSenderKey('jane@example.com')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keys distinct addresses distinctly', () => {
    expect(deriveSenderKey('a@example.com')).not.toBe(deriveSenderKey('b@example.com'));
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('strips `+suffix` aliases from the local part (D12 example)', () => {
    // The exact D12-body example: `foo+notion@gmail.com` → `foo@gmail.com`.
    expect(normalizeEmail('foo+notion@gmail.com')).toBe('foo@gmail.com');
  });

  it('strips multi-`+` suffixes from the first `+` onward', () => {
    expect(normalizeEmail('foo+a+b@example.com')).toBe('foo@example.com');
  });

  it('lowercases the address before stripping `+`', () => {
    expect(normalizeEmail('Foo+Notion@GMAIL.com')).toBe('foo@gmail.com');
  });

  it('leaves the address unchanged when there is no `+` in the local part', () => {
    expect(normalizeEmail('noreply@example.com')).toBe('noreply@example.com');
  });

  it('does NOT strip when `+` is the first local character (no alias root)', () => {
    // `+only@x.com` → empty local part if stripped; keep the input.
    expect(normalizeEmail('+only@example.com')).toBe('+only@example.com');
  });

  it('does NOT strip when `+` is only in the domain part', () => {
    // `+` is not legal in domains, but be defensive — only strip from local.
    expect(normalizeEmail('jane@exa+mple.com')).toBe('jane@exa+mple.com');
  });

  it('returns the lowercased input unchanged when there is no `@`', () => {
    expect(normalizeEmail('not-an-email')).toBe('not-an-email');
  });

  it('returns the lowercased input unchanged when local part is empty', () => {
    expect(normalizeEmail('@example.com')).toBe('@example.com');
  });
});

describe('deriveSenderKey — D12 `+suffix` collapse', () => {
  it('keys `foo+notion@gmail.com` and `foo@gmail.com` to the same hash', () => {
    // The whole point of D12's strip — Notion's plus-aliased newsletters
    // collapse to one sender row instead of fragmenting per-alias.
    expect(deriveSenderKey('foo+notion@gmail.com')).toBe(deriveSenderKey('foo@gmail.com'));
  });

  it('keys distinct local parts distinctly even with the same `+suffix`', () => {
    expect(deriveSenderKey('alice+x@example.com')).not.toBe(deriveSenderKey('bob+x@example.com'));
  });
});

describe('emailDomain', () => {
  it('returns the lowercased domain part', () => {
    expect(emailDomain('jane@Example.com')).toBe('example.com');
  });

  it('returns empty string when there is no @', () => {
    expect(emailDomain('not-an-email')).toBe('');
  });
});

describe('parseFromHeader', () => {
  it('parses a quoted display name + angle-bracketed address', () => {
    expect(parseFromHeader('"Jane Doe" <jane@example.com>')).toEqual({
      displayName: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('parses an unquoted display name', () => {
    expect(parseFromHeader('Jane Doe <jane@example.com>')).toEqual({
      displayName: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('parses a bare address with no display name', () => {
    expect(parseFromHeader('jane@example.com')).toEqual({
      displayName: '',
      email: 'jane@example.com',
    });
  });

  it('returns null for a missing or unusable header', () => {
    expect(parseFromHeader(null)).toBeNull();
    expect(parseFromHeader('')).toBeNull();
    expect(parseFromHeader('Mailer Daemon')).toBeNull();
  });
});
