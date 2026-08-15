import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePemChain, verifyVmc, VMC_EKU_OID } from './vmc-verifier.js';

/**
 * VMC verification tests (ADR-0034 Phase 2).
 *
 * Run against a REAL certificate chain generated with OpenSSL
 * (`__fixtures__/vmc/`, see its README), not mocks — the whole point of
 * this module is X.509 behaviour, and a mocked cert would test nothing
 * but our own assumptions about one.
 *
 * Every negative case is an attack someone would actually try:
 * a cert that is not a VMC, a genuine VMC replayed against another
 * brand, a VMC that does not commit to the artwork being served, and a
 * chain signed by a CA nobody trusts.
 */

const FIXTURES = join(import.meta.dirname, '__fixtures__', 'vmc');
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

const LOGO = readFileSync(join(FIXTURES, 'logo.svg'));
const ROOT = read('root.crt');
const ANCHORS = [ROOT];
const DOMAIN = 'brand.example';

/**
 * Inside the fixtures' validity window. Their `notBefore` is whenever
 * `gen-vmc.sh` ran, so this must sit comfortably after that and well
 * inside the 100-year `notAfter`.
 */
const NOW = new Date('2026-09-01T00:00:00Z');

function verify(certFile: string, overrides: Record<string, unknown> = {}) {
  return verifyVmc({
    pem: read(certFile),
    domain: DOMAIN,
    logo: LOGO,
    now: NOW,
    trustAnchors: ANCHORS,
    ...overrides,
  });
}

describe('parsePemChain', () => {
  it('reads every certificate in a bundle, leaf first', () => {
    const chain = parsePemChain(`${read('rogue.crt')}\n${read('rogue-root.crt')}`);
    expect(chain).toHaveLength(2);
    expect(chain[0]?.subject).toContain('rogue.brand.example');
    expect(chain[1]?.subject).toContain('Rogue Root');
  });

  it('refuses a bundle with a malformed block rather than verifying part of it', () => {
    expect(
      parsePemChain(
        `${read('valid.crt')}\n-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----`,
      ),
    ).toEqual([]);
  });

  it('returns nothing for input carrying no certificate', () => {
    expect(parsePemChain('')).toEqual([]);
    expect(parsePemChain('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toEqual(
      [],
    );
  });
});

describe('verifyVmc', () => {
  it('accepts a real VMC for the right domain, logo and trust anchor', () => {
    expect(verify('valid.crt')).toEqual({ ok: true });
  });

  it('rejects a certificate that is not a VMC', () => {
    // A public CA will issue an attacker a TLS cert for their own
    // domain all day. The BIMI EKU is what it will not issue.
    const result = verify('no-eku.crt');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/not a VMC/);
  });

  it("rejects a genuine VMC replayed against another brand's domain", () => {
    const result = verify('wrong-san.crt');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/SAN/);
  });

  it('rejects a VMC that carries no logotype extension', () => {
    const result = verify('no-logo.crt');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/logotype/);
  });

  it('rejects a valid VMC serving artwork it does not commit to', () => {
    // The attack a VMC-holder could otherwise run: real certificate for
    // their own brand, someone else's logo behind the `l=` URL.
    const result = verify('valid.crt', { logo: Buffer.from('<svg>someone elses mark</svg>') });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/does not commit/);
  });

  it('rejects a chain signed by a CA nobody trusts', () => {
    const result = verifyVmc({
      pem: `${read('rogue.crt')}\n${read('rogue-root.crt')}`,
      domain: DOMAIN,
      logo: LOGO,
      now: NOW,
      trustAnchors: ANCHORS,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/trusted root/);
  });

  it('rejects a self-signed leaf presented alone', () => {
    const result = verifyVmc({
      pem: read('rogue-root.crt'),
      domain: DOMAIN,
      logo: LOGO,
      now: NOW,
      trustAnchors: ANCHORS,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an expired certificate', () => {
    // Evaluated well past the fixtures' window rather than baking an
    // expired cert — OpenSSL 3.0 has no -not_before.
    const result = verify('valid.crt', { now: new Date('2200-01-01T00:00:00Z') });
    expect(result).toEqual({ ok: false, reason: 'vmc: expired' });
  });

  it('rejects a certificate that is not yet valid', () => {
    const result = verify('valid.crt', { now: new Date('2000-01-01T00:00:00Z') });
    expect(result).toEqual({ ok: false, reason: 'vmc: not yet valid' });
  });

  it('rejects an empty or unparseable bundle', () => {
    expect(verifyVmc({ pem: '', domain: DOMAIN, logo: LOGO, trustAnchors: ANCHORS })).toEqual({
      ok: false,
      reason: 'vmc: no certificate in bundle',
    });
  });

  it('does not accept the real public trust store for a fixture chain', () => {
    // Guards the injectable-anchors seam itself: if `trustAnchors` were
    // ever ignored, this fixture would verify against Mozilla's roots,
    // which would be a catastrophic bug rather than a test failure.
    const result = verifyVmc({ pem: read('valid.crt'), domain: DOMAIN, logo: LOGO, now: NOW });
    expect(result.ok).toBe(false);
  });

  it('pins the VMC EKU OID', () => {
    expect(VMC_EKU_OID).toBe('1.3.6.1.5.5.7.3.31');
  });
});
