import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';

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

/**
 * THE REGRESSION SUITE FOR THE 2026-08-17 OUTAGE.
 *
 * Everything above runs on OpenSSL-generated fixtures, and that is
 * precisely why all of it stayed green while the feature was 100% dead
 * in production: the generated logotype carries the logo's SHA-256 and
 * the chain ends at a fixture CA, so the fixtures agreed with the two
 * assumptions that were wrong. Real VMCs commit with SHA-1 and chain to
 * a Verified Mark root that is not in any TLS trust store.
 *
 * These cases use an unmodified production chain and the DEFAULT trust
 * anchors, so they fail if either assumption is reintroduced.
 */
describe('verifyVmc against a real production VMC', () => {
  const REAL = join(FIXTURES, 'real');
  const REAL_CHAIN = readFileSync(join(REAL, 'bankofamerica.chain.pem'), 'utf8');
  const REAL_LOGO = readFileSync(join(REAL, 'bankofamerica.svg'));
  /** Inside the leaf's 2026-04-11 → 2027-04-13 window; see the README. */
  const REAL_NOW = new Date('2026-09-01T00:00:00Z');

  const verifyReal = (overrides: Record<string, unknown> = {}) =>
    verifyVmc({
      pem: REAL_CHAIN,
      domain: 'bankofamerica.com',
      logo: REAL_LOGO,
      now: REAL_NOW,
      ...overrides,
    });

  it('accepts it with the shipped defaults', () => {
    // The end-to-end assertion: no injected anchors, no adjusted logo.
    // This exact input returned `does not commit to this logo`, and
    // then `chain does not reach a trusted root`, before the fix.
    expect(verifyReal()).toEqual({ ok: true });
  });

  it('accepts a SHA-1 logotype commitment', () => {
    // Stated as its own case so the intent survives a fixture swap:
    // the ecosystem commits with SHA-1, and hardcoding SHA-256 was the
    // bug. Assert the fixture really is SHA-1 so this cannot quietly
    // become a re-test of the SHA-256 path.
    const sha1 = createHash('sha1').update(REAL_LOGO).digest();
    const sha256 = createHash('sha256').update(REAL_LOGO).digest();
    const der = parsePemChain(REAL_CHAIN)[0]!.raw;
    expect(der.includes(sha1)).toBe(true);
    expect(der.includes(sha256)).toBe(false);
    expect(verifyReal()).toEqual({ ok: true });
  });

  it('still refuses artwork the real certificate does not commit to', () => {
    // Accepting SHA-1 must not weaken the check it implements: a
    // genuine VMC serving someone else's mark is the attack.
    const result = verifyReal({ logo: Buffer.from('<svg>someone elses mark</svg>') });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/does not commit/);
  });

  it('still refuses a real VMC replayed against another brand', () => {
    const result = verifyReal({ domain: 'declutrmail.com' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/SAN/);
  });

  it('does not verify against Node’s TLS root store', () => {
    // The precise reason check 5 could never pass: Mozilla's bundle is
    // for server authentication and carries no Verified Mark roots. If
    // someone "simplifies" the pinned anchors back to `rootCertificates`,
    // this fails instead of the feature silently dying again.
    const result = verifyReal({ trustAnchors: rootCertificates });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/trusted root/);
  });
});
