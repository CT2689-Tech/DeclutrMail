# VMC test fixtures (ADR-0034 Phase 2)

A real certificate chain, generated with OpenSSL, for
`vmc-verifier.test.ts`. The module under test is X.509 behaviour, so a
mocked certificate would test nothing but our own assumptions about
one.

| file              | what it is                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `logo.svg`        | The image the valid certificate commits to                        |
| `root.crt`        | The test CA — passed to `verifyVmc` as an injected trust anchor    |
| `valid.crt`       | A well-formed VMC: BIMI EKU, SAN `brand.example`, logo hash        |
| `no-eku.crt`      | Same, minus the BIMI EKU — an ordinary certificate                 |
| `wrong-san.crt`   | A genuine VMC for a different domain (replay attempt)              |
| `no-logo.crt`     | A VMC with no logotype extension                                   |
| `rogue.crt`       | A complete, correct VMC signed by a CA nobody trusts               |
| `rogue-root.crt`  | The CA that signed it                                              |

## Why these are committed

Generating per-run would put OpenSSL on CI's critical path and make the
suite depend on a binary that is not otherwise required. They carry a
100-year `notAfter`, and expiry is tested through `verifyVmc`'s
injectable clock rather than a baked expired certificate (OpenSSL 3.0
has no `-not_before`).

## The trust anchor is injected, deliberately

A fixture chain can never reach a real public root, so `verifyVmc`
takes `trustAnchors`. That seam is itself a hazard — if it were ever
ignored, the fixtures would be evaluated against Mozilla's real root
store — so `vmc-verifier.test.ts` asserts that `valid.crt` does NOT
verify when the anchors are left to default.

## Regenerating

`scripts/gen-vmc.sh` in the session scratchpad produced these. The
logotype extension is a stand-in: a SEQUENCE carrying the image's
SHA-256 as an OCTET STRING, not a full RFC 6170 `LogotypeExtn`. That
matches what the verifier actually checks — it scans for the hash after
the extension OID rather than parsing the nested grammar, and
`vmc-verifier.ts` documents why.
