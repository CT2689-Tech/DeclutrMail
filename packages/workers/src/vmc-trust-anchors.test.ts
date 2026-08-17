import { X509Certificate } from 'node:crypto';
import { rootCertificates } from 'node:tls';

import { describe, expect, it } from 'vitest';

import { VMC_TRUST_ANCHORS, VMC_TRUST_ANCHOR_FINGERPRINTS } from './vmc-trust-anchors.js';

/**
 * Guards the pinned anchors themselves (ADR-0034).
 *
 * These blobs are the trust decision for the whole feature, and they
 * are the kind of thing an editor, a formatter or a careless paste can
 * corrupt without anything else noticing — a truncated PEM would just
 * turn every logo back into a monogram, which is indistinguishable from
 * "no brand publishes one". So the properties are asserted rather than
 * assumed.
 */
describe('VMC trust anchors', () => {
  it('carries the two roots the fingerprints document', () => {
    expect(VMC_TRUST_ANCHORS).toHaveLength(VMC_TRUST_ANCHOR_FINGERPRINTS.length);
    expect(VMC_TRUST_ANCHORS).toHaveLength(2);
  });

  it('parses, and each blob hashes to its recorded fingerprint', () => {
    VMC_TRUST_ANCHORS.forEach((pem, i) => {
      const cert = new X509Certificate(pem);
      expect(cert.fingerprint256).toBe(VMC_TRUST_ANCHOR_FINGERPRINTS[i]);
    });
  });

  it('holds only self-signed roots, in date, from the expected CAs', () => {
    // A root that does not verify its own signature is not a root, and
    // an out-of-date anchor silently disables every brand under it.
    const now = new Date();
    for (const pem of VMC_TRUST_ANCHORS) {
      const cert = new X509Certificate(pem);
      expect(cert.verify(cert.publicKey)).toBe(true);
      expect(cert.subject).toBe(cert.issuer);
      expect(new Date(cert.validFrom).getTime()).toBeLessThan(now.getTime());
      expect(new Date(cert.validTo).getTime()).toBeGreaterThan(now.getTime());
      expect(cert.subject).toMatch(/Verified Mark/);
    }
  });

  it('is disjoint from Node’s TLS root store', () => {
    // Not a curiosity — it is the whole reason this file exists. If a
    // Node release ever did ship these, the original `rootCertificates`
    // approach would become viable and this pin could be revisited;
    // until then, asserting the gap keeps the rationale honest.
    const tlsRoots = new Set(
      rootCertificates.map((pem) => {
        try {
          return new X509Certificate(pem).fingerprint256;
        } catch {
          return '';
        }
      }),
    );
    for (const fingerprint of VMC_TRUST_ANCHOR_FINGERPRINTS) {
      expect(tlsRoots.has(fingerprint)).toBe(false);
    }
  });
});
