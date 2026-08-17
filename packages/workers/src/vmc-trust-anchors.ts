/**
 * Pinned VMC trust anchors (ADR-0034).
 *
 * ─── WHY NOT NODE'S BUNDLED ROOT STORE ────────────────────────────────
 *
 * `vmc-verifier.ts` originally anchored the chain in `tls.rootCertificates`,
 * reasoning that a hand-maintained list "would either be wrong (feature
 * silently dead) or, worse, wrong in the permissive direction". The
 * first of those is exactly what shipped, because the premise was
 * wrong: Node's bundle IS Mozilla's store, and Mozilla's store exists
 * for TLS SERVER AUTHENTICATION. Verified Mark roots are not in it and
 * are not meant to be — they are distributed through the BIMI Group's
 * authorised-CA list, a separate trust programme with a trademark check
 * rather than a domain check at its centre.
 *
 * Measured 2026-08-17: Node 24 ships 146 roots, of which ZERO are VMC
 * roots. So check 5 rejected every certificate that reached it, and
 * because rejection falls back to a monogram the feature looked like
 * "no brand publishes a logo" rather than "verification cannot pass".
 * Every one of 16 live VMCs sampled that day terminated at one of the
 * two roots below.
 *
 * ─── THIS NARROWS TRUST, IT DOES NOT WIDEN IT ─────────────────────────
 *
 * Worth stating plainly, because pinning usually reads as the riskier
 * option: anchoring in the TLS store was the PERMISSIVE choice. Any of
 * 146 public CAs could satisfy it, so the only thing standing between
 * an attacker's own TLS certificate and a rendered logo was the EKU
 * byte-scan. Anchoring here requires the issuer to be an actual VMC CA,
 * which is the property BIMI verification is supposed to establish.
 *
 * ─── PROVENANCE ───────────────────────────────────────────────────────
 *
 * Each root was confirmed two independent ways before being pinned:
 * fetched from the CA's own HTTPS distribution point (itself validated
 * by the public TLS PKI), AND fingerprint-matched against the root
 * presented in a live BIMI chain. A root that could only be confirmed
 * one way is not in this file.
 *
 * Entrust is the third CA on the BIMI authorised list and is
 * DELIBERATELY ABSENT: no live Entrust-issued VMC turned up in 34
 * sampled domains and its published root could not be retrieved, so it
 * failed the two-way bar above. Adding it is a follow-up that needs the
 * same evidence, not a guess — see FOUNDER-FOLLOWUPS.md.
 *
 * Renewal: both roots are long-lived (DigiCert to 2049, GlobalSign to
 * 2042). `vmc-trust-anchors.test.ts` asserts they parse, are
 * self-signed, are in date, and match the fingerprints recorded here,
 * so a swapped or truncated blob fails the suite rather than the
 * feature.
 */

/**
 * DigiCert Verified Mark Root CA.
 *
 * Source:      https://cacerts.digicert.com/DigiCertVerifiedMarkRootCA.crt
 * SHA-256:     50:43:86:C9:EE:89:32:FE:CC:95:FA:DE:42:7F:69:C3:
 *              E2:53:4B:73:10:48:9E:30:0F:EE:44:8E:33:C4:6B:42
 * Valid:       2019-09-23 → 2049-09-23
 * Confirmed:   2026-08-17, matching the root presented by
 *              bankofamerica.com, paypal.com, chase.com and 12 others.
 */
export const DIGICERT_VERIFIED_MARK_ROOT_CA = `-----BEGIN CERTIFICATE-----
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
0wberd/tg3N0dJsSSznZjwYB
-----END CERTIFICATE-----`;

/**
 * GlobalSign Verified Mark Root R42.
 *
 * Source:      https://secure.globalsign.com/cacert/gsverifiedmarkrootr42.crt
 *              (the CA-Issuers AIA URI published by the issuing
 *              intermediate, so the pointer comes from the chain itself
 *              rather than a guessed path)
 * SHA-256:     CD:12:2C:B8:77:C6:92:8B:90:17:B0:F0:B8:0D:BD:50:
 *              81:96:30:0B:BD:03:CD:73:56:C3:BE:EF:52:4E:7E:0B
 * Valid:       2023-11-15 → 2042-11-15
 * Confirmed:   2026-08-17, matching the root presented by bestbuy.com.
 */
export const GLOBALSIGN_VERIFIED_MARK_ROOT_R42 = `-----BEGIN CERTIFICATE-----
MIIFdDCCA1ygAwIBAgIQf+UwA4GYp199F8APJCyr8zANBgkqhkiG9w0BAQwFADBU
MQswCQYDVQQGEwJCRTEZMBcGA1UEChMQR2xvYmFsU2lnbiBudi1zYTEqMCgGA1UE
AxMhR2xvYmFsU2lnbiBWZXJpZmllZCBNYXJrIFJvb3QgUjQyMB4XDTIzMTExNTAz
NDA1MloXDTQyMTExNTAwMDAwMFowVDELMAkGA1UEBhMCQkUxGTAXBgNVBAoTEEds
b2JhbFNpZ24gbnYtc2ExKjAoBgNVBAMTIUdsb2JhbFNpZ24gVmVyaWZpZWQgTWFy
ayBSb290IFI0MjCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBANzqTcvu
bRbqX0CzP7sZbHfd1usqWOPrHzoLvbZTnJqt9WgBwQwcGEFl8rmIcOss7XmewAqj
oCx7PQp1FJ+/o/yGezMbnPCglAVwWptUOMIa7UJ/8qrV50/qQSRN8s8MAcnhj3Ab
Ja/mVjlMHzjYCo0O+jc24uHlEHcIo3vJPsP2Sy9HwcMH4wB2rQ4xDN7kAn5NmqXI
xAvSnJ2KGrZsoNx8MGAfX5dl0ACOpaaqbonBGtawvRGAE6f747E+pUamjGjisQ8y
ZC0X5Ht1s53sliy9AHDpOUWVcCLOoQCP/Y8yDjkjE1VWiL1Y7LlCnYfAVfY87DRD
81toIOLjFNACxeG02Qvgzg0JMKh81seiZfSLbq8DgepDABUTs8WYpN/u52/kdM+/
UeaQEn+q2HDDI8OMmBqwVo98k+dCQ0QgKLkHaLxpm5EjacSkNZFeqp1ttDZsGKQt
9REPJxpY6OO9KSYuFNFpnmLfaDNA/VngLw+Z4hYH59RnE2p3s95CfUa+CT4BUvDy
Wefc9RNiJVppbQNiZ4DKKpixVfXptgukbnh5l7vyDVonKGdgNEZeN5YjopM5V2+J
eIrsC3u0OmDV41cSFfe/1dmoUhy5EfTgWXqLOOgoUxqy62Yl7DDwoyXerEzDzZAq
nSBE/HAra3/d5pdj8/5WXoybjbXYM/bsKALLAgMBAAGjQjBAMA4GA1UdDwEB/wQE
AwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBQ9s+P1IK6506ybFLxwJe4P
Cn6VyTANBgkqhkiG9w0BAQwFAAOCAgEA24nHkncSyqeuk1lkpRq/MLVHdVONJnZ6
t8OZEu3nr6DHAuImAonIqO8HcBcgwydDIAeD7GOafOZ47mRkYOFIa+tkJ21pfmJv
KUt3ASW1uLAHCJNYHVLXs7txnq1mRKuwyuaeb6JdTazzjXgNDLZQgvOfM7mkDf6f
S2Z+dbKOZBYwo6zspqoQc1s6k0Xg9h7oEiJCC+3FUfJQSYyi2bynZSEn2c67OSFT
fqXVr9nhlaawLGEKUaFlYeQspUO5MUFYmGWqnf38M8ZM0rPx5R00jZ/E5sKcSqFH
CaVghDPiVv9Jzs8gNllwDbi7rXwMstaKATJJXiWgSdsxrfQr7+FRyXQJmRVXKxZ6
6uNe1ZgAzgNbjCvGmwF1StBtr1DrdOSk7sOMBMuJftB2g9/K67VUfz+jkylIbv5y
bvnCqBoAvq2DSQ76O5WyWiTBkPYp2Fh/WMHkXVIQpT6Q7FMTiGxtAxv69sq1CeJ9
i9g/iAJBdToQwJwH80Ah3hSPg1DQ8LTIjTtOxxkJ6Aeh/XU1/w9lW91XGLgXye1U
fjUIWKsoe1rE2RK+RSP6BZWcRNhJOyqi40gdTRLJkbc0Itq/62NFV4mIWcWKafhb
4ZOU1rvk1woeteJJZHd7cLakW6ONJAEtWGe43ZVx/lqFXQH4kOMPuR/7h2G1Aie6
Fk6hsIjUv20=
-----END CERTIFICATE-----`;

/** Every root a VMC may terminate at. Order is not significant. */
export const VMC_TRUST_ANCHORS: readonly string[] = [
  DIGICERT_VERIFIED_MARK_ROOT_CA,
  GLOBALSIGN_VERIFIED_MARK_ROOT_R42,
];

/**
 * SHA-256 fingerprints of the above, in `X509Certificate.fingerprint256`
 * form. Kept beside the PEMs so the test can assert the blobs still
 * hash to what this file's provenance comments claim.
 */
export const VMC_TRUST_ANCHOR_FINGERPRINTS: readonly string[] = [
  '50:43:86:C9:EE:89:32:FE:CC:95:FA:DE:42:7F:69:C3:E2:53:4B:73:10:48:9E:30:0F:EE:44:8E:33:C4:6B:42',
  'CD:12:2C:B8:77:C6:92:8B:90:17:B0:F0:B8:0D:BD:50:81:96:30:0B:BD:03:CD:73:56:C3:BE:EF:52:4E:7E:0B',
];
