import { createHash, X509Certificate } from 'node:crypto';

import { VMC_TRUST_ANCHORS } from './vmc-trust-anchors.js';

/**
 * VMC verification (ADR-0034 Phase 2).
 *
 * A BIMI record's `l=` tag is just a URL a domain owner published, so
 * on its own it proves nothing: anyone can register
 * `chase-security-alerts.example` and point `l=` at Chase's artwork.
 * The `a=` tag is what makes the claim checkable — a Verified Mark
 * Certificate, an X.509 cert issued by one of a small set of CAs that
 * verify the applicant actually owns the trademark, and which commits
 * to the specific image the brand is entitled to display.
 *
 * Founder decision 2026-08-15: logos do not render without this. It is
 * the only control that actually fixes the lookalike problem — a
 * tenure or surface rule prices the attack up, verification removes
 * it — and it is the bar Gmail itself sets before showing a BIMI logo.
 *
 * Four things must all hold, and any failure means "no logo" (the
 * caller falls back to the monogram, so failing closed is free):
 *
 *   1. The chain validates to an AUTHORISED VMC ROOT — the pinned set
 *      in `vmc-trust-anchors.ts`, not Node's bundled root store. That
 *      store is Mozilla's TLS trust list and contains no VMC roots at
 *      all, so anchoring there rejected every real certificate and
 *      took the whole feature down silently. Pinning is also the
 *      STRICTER option here, not the looser one: the TLS store would
 *      accept any of 146 public CAs, leaving the EKU scan as the only
 *      thing distinguishing a VMC from an ordinary server cert.
 *   2. The leaf carries the VMC extended-key-usage OID. This is the
 *      real discriminator: a public CA will happily issue a TLS cert
 *      for an attacker's own domain, but only a BIMI-authorised CA
 *      issues one bearing `id-kp-BrandIndicatorforMessageIdentification`,
 *      and only after a trademark check.
 *   3. The leaf's SAN covers the sender domain, so a genuine VMC for
 *      one brand cannot be replayed against another.
 *   4. The certificate COMMITS TO THIS EXACT IMAGE. Without this, an
 *      attacker holding any legitimate VMC for their own brand could
 *      serve Chase's artwork under it.
 *
 * ─── ON THE TWO EXTENSION CHECKS ──────────────────────────────────────
 *
 * `node:crypto` exposes chain, validity and SAN, but not arbitrary
 * extensions, and the alternatives were both worse than a byte scan:
 * `@peculiar/x509` requires a global `reflect-metadata` polyfill, which
 * is an invasive thing to impose on a deliberately framework-agnostic
 * package, and hand-rolling a nested ASN.1 parse of `LogotypeExtn` is
 * exactly the sort of code that fails silently in the permissive
 * direction.
 *
 * So checks 2 and 4 are DER substring searches, and the reason that is
 * sound is the direction of the failure modes. A false NEGATIVE (an
 * unusual-but-valid encoding we fail to spot) costs one monogram. A
 * false POSITIVE would require the certificate's DER to contain either
 * the exact ten-byte VMC OID encoding, or the exact 32-byte SHA-256 of
 * the logo we just fetched — and a CA putting that hash in a
 * certificate is precisely the attestation we are looking for. There
 * is no cheap way to forge either into a cert that also chains to a
 * public root.
 *
 * This is a scan, not a parse, and it is documented as such so nobody
 * later mistakes it for full RFC 6170 processing.
 * ──────────────────────────────────────────────────────────────────────
 */

/** `id-kp-BrandIndicatorforMessageIdentification` — the VMC EKU. */
export const VMC_EKU_OID = '1.3.6.1.5.5.7.3.31';

/** DER encoding of `VMC_EKU_OID` as an OBJECT IDENTIFIER. */
const VMC_EKU_DER = Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x1f]);

/** DER encoding of the `id-pe-logotype` extension OID (1.3.6.1.5.5.7.1.12). */
const LOGOTYPE_EXT_DER = Buffer.from([0x06, 0x08, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x01, 0x0c]);

/**
 * Digests to try for the logotype commitment (check 4).
 *
 * THE ALGORITHM IS THE CA'S CHOICE, NOT OURS. RFC 6170 carries the
 * commitment as a `HashAlgAndValue` — an AlgorithmIdentifier plus the
 * value — so the issuer states which digest it used. Assuming one was
 * this feature's total-failure bug: the first cut hashed with SHA-256
 * only, and EVERY VMC in production commits with SHA-1, so check 4
 * rejected 100% of real certificates. Verified 2026-08-17 against five
 * live VMCs from three issuers (DigiCert, Entrust, and Robinhood's
 * self-hosted bundle): bankofamerica.com, splitwise.com, paypal.com,
 * americanexpress.com, robinhood.com — all SHA-1, none SHA-256.
 *
 * Because rejection is DESIGNED to fall back to a monogram, the failure
 * was silent and looked exactly like "these brands publish no logo".
 * Hence the list rather than a second hardcoded guess: the next issuer
 * to modernize must not take the feature down again for another round.
 *
 * ON ACCEPTING SHA-1. This is not the usual SHA-1-is-broken case, and
 * the distinction is the whole justification:
 *
 *   - The attack this check stops is SECOND-PREIMAGE: take the hash a
 *     CA already certified for someone else's mark and produce a
 *     different SVG matching it. SHA-1 second-preimage resistance is
 *     NOT broken (~2^160); only COLLISION resistance is.
 *   - The collision variant needs the attacker to author both images
 *     up front and then get a BIMI-authorised CA to certify one of
 *     them — which means passing that CA's trademark verification for
 *     a mark they own. It buys a wrong logo in a 28px avatar rendered
 *     beside the sender's real name, which we always show.
 *   - Refusing SHA-1 buys no security, only zero logos: it rejects
 *     every certificate the ecosystem actually issues. Gmail, Apple
 *     Mail and Yahoo render these same certs.
 *
 * A false positive still needs the DER after the logotype OID to
 * contain the exact digest of the image we just fetched, which remains
 * the attestation we are looking for — see the module note on why this
 * is a scan and not a parse.
 */
const LOGO_HASH_ALGORITHMS = ['sha1', 'sha256', 'sha512'] as const;

/** Chain depth ceiling — a real VMC chain is leaf + 1-2 intermediates. */
const MAX_CHAIN_DEPTH = 8;

export type VmcResult = { ok: true } | { ok: false; reason: string };

export interface VmcOptions {
  /** The PEM bundle fetched from the record's `a=` URL. */
  pem: string;
  /** Brand-root domain the BIMI record was published on. */
  domain: string;
  /** The bytes fetched from `l=`, which the cert must commit to. */
  logo: Buffer;
  /** Clock seam for tests. */
  now?: Date;
  /**
   * Trust anchors as PEM strings. Defaults to the pinned VMC roots —
   * NOT Node's TLS store, which contains none (see
   * `vmc-trust-anchors.ts`). Injectable ONLY so tests can supply their
   * own CA; a fixture chain can never reach a real VMC root.
   */
  trustAnchors?: readonly string[];
}

/** Split a PEM bundle into certificates, leaf first. */
export function parsePemChain(pem: string): X509Certificate[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  if (!blocks) return [];
  const certs: X509Certificate[] = [];
  for (const block of blocks.slice(0, MAX_CHAIN_DEPTH)) {
    try {
      certs.push(new X509Certificate(block));
    } catch {
      // A malformed block invalidates the bundle — refuse rather than
      // verify a partial chain.
      return [];
    }
  }
  return certs;
}

export function verifyVmc(opts: VmcOptions): VmcResult {
  const now = opts.now ?? new Date();
  const chain = parsePemChain(opts.pem);
  if (chain.length === 0) return { ok: false, reason: 'vmc: no certificate in bundle' };

  const leaf = chain[0]!;

  // 1. Validity — every cert in the presented chain.
  for (const cert of chain) {
    if (new Date(cert.validFrom) > now) return { ok: false, reason: 'vmc: not yet valid' };
    if (new Date(cert.validTo) < now) return { ok: false, reason: 'vmc: expired' };
  }

  // 2. SAN must cover the domain. `subject: 'never'` refuses the legacy
  //    CN fallback — a VMC always carries a dNSName SAN, and accepting
  //    a CN match would widen this for no benefit.
  if (!leaf.checkHost(opts.domain, { subject: 'never' })) {
    return { ok: false, reason: 'vmc: domain not in certificate SAN' };
  }

  // 3. The VMC EKU. See the module note on why this is a scan.
  if (leaf.raw.indexOf(VMC_EKU_DER) === -1) {
    return { ok: false, reason: 'vmc: certificate is not a VMC (no BIMI EKU)' };
  }

  // 4. The cert must commit to THIS image.
  const logotypeAt = leaf.raw.indexOf(LOGOTYPE_EXT_DER);
  if (logotypeAt === -1) return { ok: false, reason: 'vmc: no logotype extension' };
  // Scoped to the bytes after the extension OID: extensions are laid
  // out sequentially, so the logotype content follows its own OID.
  const logotype = leaf.raw.subarray(logotypeAt);
  if (
    !LOGO_HASH_ALGORITHMS.some((alg) =>
      logotype.includes(createHash(alg).update(opts.logo).digest()),
    )
  ) {
    return { ok: false, reason: 'vmc: certificate does not commit to this logo' };
  }

  // 5. Chain to an authorised VMC root.
  return verifyChain(chain, opts.trustAnchors ?? VMC_TRUST_ANCHORS, now);
}

/**
 * Walk leaf → … → a trusted anchor, checking issuance and signature at
 * every link. The presented bundle may or may not include the root, so
 * both shapes are accepted; what is NOT accepted is stopping at a cert
 * nobody vouches for.
 */
function verifyChain(chain: X509Certificate[], anchors: readonly string[], now: Date): VmcResult {
  for (let i = 0; i < chain.length - 1; i++) {
    const child = chain[i]!;
    const parent = chain[i + 1]!;
    if (!child.checkIssued(parent) || !child.verify(parent.publicKey)) {
      return { ok: false, reason: 'vmc: broken certificate chain' };
    }
  }

  const top = chain[chain.length - 1]!;
  for (const anchorPem of anchors) {
    let anchor: X509Certificate;
    try {
      anchor = new X509Certificate(anchorPem);
    } catch {
      continue;
    }
    // The bundle already ended at this root.
    if (top.raw.equals(anchor.raw)) {
      return new Date(anchor.validTo) < now
        ? { ok: false, reason: 'vmc: trust anchor expired' }
        : { ok: true };
    }
    if (top.checkIssued(anchor) && top.verify(anchor.publicKey)) {
      return new Date(anchor.validTo) < now
        ? { ok: false, reason: 'vmc: trust anchor expired' }
        : { ok: true };
    }
  }

  return { ok: false, reason: 'vmc: chain does not reach a trusted root' };
}
