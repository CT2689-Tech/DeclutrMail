# ADR-0034: Brand logos return through a first-party, globally-cached icon endpoint (BIMI first)

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D7/D228 (privacy posture — the trust wedge),
  D1/D2 (Geist + cool/editorial palette), D156 (rate limiting),
  D203/D225 (worker policies)
- **Related ADRs:** supersedes **ADR-0024 §Decision 3** (logo deferral);
  ADR-0016 (senders visual language), ADR-0025 (feature-flag manifest)

## Context

ADR-0024 removed a 3-tier third-party favicon waterfall (Clearbit →
DuckDuckGo → Google S2 → letter bubble) and made `Avatar` a pure
monogram. Two problems drove that: every rendered sender leaked that
domain to three vendors **from the user's browser with the user's IP
attached**, and mixed-fidelity sources produced page-level visual
variance that read as cheap.

ADR-0024 §Decision 3 explicitly deferred rather than banned logos: they
may return "exclusively through a first-party `GET /api/icons/:domain`
proxy (server-side fetch + cache + quality gate, monogram fallback)".
This ADR is that endpoint.

Founder review (2026-08-14) reopened it against the Monarch Money
reference — recognizable institution marks materially raise perceived
quality on financial senders. Monarch's advantage, though, is not that
logos beat monograms; it is that Monarch normalizes every mark to one
silhouette. Fidelity _variance_ is what reads as cheap, not monograms.

Two facts reshaped the design away from ADR-0024's sketch:

1. **BIMI exists and ADR-0024 did not consider it.** Brands publish
   their own logo via a DNS TXT record at `default._bimi.<domain>`
   pointing at an SVG, VMC-verified. No vendor, no account, no bill, no
   licensing ambiguity — the brand authorized it, and it is the same
   mechanism Gmail itself uses for sender avatars. Coverage skews to
   exactly the household names users recognize.
2. **BIMI serves SVG, so Phase 1 needs no image processing.** Vector
   scales to every avatar size with no raster normalization, no
   quality-gate-by-pixel-size, and — decisively — no `sharp`
   dependency (the workspace has none today).

## Decision

### 1. One global cache keyed by domain, with no user linkage

`domain_icons` is keyed on the brand-root domain alone (`chase.com`,
bulk-mail prefixes stripped by the same `brandRoot()` the monogram tint
uses). It carries **no `user_id` and no `mailbox_account_id`**.

This is a hard privacy requirement, not an optimization. A per-user
icon table is a queryable index of who receives mail from whom —
precisely the artifact D7/D228 says we do not hold. Keyed on domain
alone, the table is a public-brand-asset cache that happens to have
been populated by domains we saw.

Consequence: one outbound fetch per domain **for the entire product,
ever**. If 4,000 users receive mail from Chase, that is one fetch and
3,999 cache hits. Distinct-domain count grows sublinearly with users
because sender domains follow a hard power law, so the cache improves
as the userbase grows.

### 2. Cache misses are cached

A domain with no discoverable logo is written as `status='none'` with a
TTL, not left absent. Without this, every render of a logo-less sender
re-enqueues a fetch forever — a self-inflicted DDoS, and the most
common way this pattern fails. TTLs: 90d on `ok`, 30d on `none` (so
rebrands and newly-published BIMI records eventually land).

### 3. The read path never blocks on an outbound fetch

`GET /api/icons/:domain` answers only from cache:

| cache state | response                                                                       |
| ----------- | ------------------------------------------------------------------------------ |
| `ok`        | `200 image/svg+xml` + strong ETag + `max-age=86400` + `stale-while-revalidate` |
| `none`      | `204` + `max-age=60`                                                           |
| absent      | `204` + `max-age=60`, and enqueue a fetch job                                  |

`204` is the contract for "monogram, and we're on it" — not an error. A
cold domain costs a render nothing.

**The two lifetimes must differ, and shipping them the same broke the
feature outright.** A `204` is provisional by construction: the lookup
that produced it only _enqueued_ resolution, and the mark lands seconds
later. The first cut sent the hit's `max-age=86400,
stale-while-revalidate=604800` on the `204` as well, so a browser that
asked once committed to "this sender has no logo" for a day and served
that answer stale for a week after. Since every domain is absent the
first time it is seen, one page view poisoned every sender at once and
no amount of successful resolution afterwards could surface a single
logo (incident 2026-08-16).

It also destroyed the evidence. `stale-while-revalidate` makes Chromium
fire a background revalidation that DevTools reports with **no
initiator, type `Other`, 0 B**, and — when the page navigates before it
lands — `(failed) net::ERR_ABORTED`. A screenful of those reads exactly
like a dead endpoint, which is what the incident was first diagnosed as.
A short `max-age` and no `stale-while-revalidate` on the miss fixes both
the behaviour and the diagnosability; 60s still collapses the re-render
fan-out of one browsing session.

The route is **readable anonymously; only a session can cause work**
(founder decision 2026-08-16, replacing a blanket `JwtGuard`).

The guard existed for two reasons. The first still holds and is still
enforced, now precisely: a miss ENQUEUES an outbound resolution, so
`mayEnqueue` is false without a session — an anonymous caller reads the
cache and can never grow it, and cannot drive our DNS and HTTPS fetches
at domains of their choosing. The second is knowingly given up: the
cache is a global set of domains our users receive mail from, so
anonymous probing turns it into an oracle for that set. It is
aggregate, carries no user linkage (§1) and holds nothing but public
brand artwork. Anonymous callers are rate-limited by IP, since the
interceptor keys on `req.user?.id ?? req.ip`.

**Why the guard could not stay.** `dm_access` lives 15 minutes, and the
web client recovers from an expired one by rotating through
`POST /api/auth/refresh` and replaying the call. A CSS
`background-image` cannot: it is a browser subresource fetch with no
code around it, deliberately, because §6 makes `Avatar` a zero-JS
server component drawn hundreds of times per page. So every visit after
the token aged out sent ~50 icon requests with a dead cookie — all 401
— while the app's own calls refreshed and worked. A perfectly
functional page with no logos, permanently, because an image never
retries. Verified in production 2026-08-16: a direct
`GET /api/icons/zillow.com` answered `HTTP 401`.

Failures on this route carry a status and **no body**. An image cannot
parse the D202 envelope, and sending one actively hid the problem:
Chromium's ORB refuses a JSON body delivered to a cross-origin no-cors
image request when `nosniff` is set, dropping the response before the
status reaches the page. DevTools showed `(failed)
net::ERR_BLOCKED_BY_ORB`, type `Other`, 0 B, no status — which is why
three rounds of fixes landed without anyone being able to see that the
answer was 401 all along.

### 4a. Nothing is stored without a verified VMC

Founder decision 2026-08-15, taken over three cheaper alternatives
(accept the risk; a sender-tenure gate; hiding logos in Screener).
Those price the attack up; only verification removes it, and it is the
bar Gmail sets before displaying a BIMI logo.

A record's `l=` tag is an assertion by whoever controls the domain, so
`chase-security-alerts.example` can point it at Chase's artwork. The
`a=` tag makes the claim checkable — a Verified Mark Certificate,
issued only by CAs that check trademark ownership, committing to a
specific image. `vmc-verifier.ts` requires all four of:

1. the chain validates to a **publicly trusted root** (Node's bundled
   Mozilla store, not a hand-maintained BIMI CA fingerprint list — a
   pinned list we cannot verify would be either silently dead or wrong
   in the permissive direction);
2. the leaf carries the **VMC extended-key-usage**
   (`1.3.6.1.5.5.7.3.31`) — the real discriminator, since a public CA
   will issue an attacker a TLS cert for their own domain but not a
   VMC;
3. the leaf's **SAN covers this domain**, so a genuine VMC cannot be
   replayed against another brand; and
4. the certificate **commits to the exact bytes** behind `l=`, which is
   what stops a legitimate VMC holder serving someone else's artwork.

The certificate is fetched through the same SSRF guard as the logo —
its URL comes from the same attacker-controlled record.

Checks 2 and 4 are DER substring searches rather than a full RFC 6170
parse. That is a deliberate trade, argued in the module header: a false
negative costs one monogram, while a false positive would require a
certificate that chains to a public root to contain either the exact
VMC OID encoding or the SHA-256 of the image we just fetched — which is
the attestation we were looking for. Full ASN.1 traversal of
`LogotypeExtn` is the classic silently-permissive failure, and the
maintained library that would avoid hand-rolling it demands a global
`reflect-metadata` polyfill this package will not take.

### 4b. Resolution cascade, server-side only

`DomainIconWorker` (`batchPolicy`, idempotency key = domain, so a
thousand concurrent misses collapse to one job):

1. **BIMI** — DNS TXT `default._bimi.<domain>`, parse the `l=` URL.
   Discovery walks the name from the domain up to its ancestors, most
   specific first, exactly as DMARC falls back to the organizational
   domain. Querying only the exact domain is why this resolved almost
   nothing: bulk mail arrives from `member.`/`official.`/`info.`/`h5.`
   subdomains and the record is published at the brand. Verified
   against live DNS 2026-08-16 — `member.americanexpress.com` and
   `official.asos.com` are NXDOMAIN while both parents answer.
   `brandRoot` cannot close this gap, since it strips a fixed list of
   bulk prefixes and the real set is open-ended.
   The certificate is then checked against the domain the record was
   **published on**, because a brand's VMC carries the brand's SAN, not
   each mailing subdomain's. No public-suffix list is needed to bound
   the walk: a record found at, say, `co.uk` still has to present a VMC
   whose SAN covers `co.uk` from a BIMI-authorised CA, so an over-broad
   walk costs an extra NXDOMAIN rather than a wrong logo (§4a).
2. **Vendor** (Brandfetch / Logo.dev) — Phase 2, config-gated; an
   absent API key skips the tier entirely.
3. Neither → `status='none'`.

No user browser ever talks to an icon source. Phase 1 has no third
party in the path at all — a DNS lookup from our resolver plus a fetch
of a brand's own asset.

### 5. The `l=` URL is attacker-controlled — fetch it behind an SSRF guard

The BIMI URL comes from a DNS record controlled by whoever owns the
sender domain, which includes every spammer who ever mailed a user. The
fetch therefore requires: `https` only, DNS resolution with rejection of
private / loopback / link-local / CGNAT / unique-local ranges
(re-checked after every redirect), a redirect cap, a response-size cap,
a wall-clock timeout, and an `image/svg+xml` content-type check.

Fetched SVG is validated against the SVG Tiny PS profile shape BIMI
requires and sanitized (no `<script>`, no event handlers, no external
references) before storage. It is rendered exclusively as a CSS
background image (see §6), where script execution is inert regardless.

### 6. Monogram is the floor, never a fallback that can fail

`Avatar` renders the monogram as its base layer **always**, and layers
the mark over it. Every failure mode — `204`, `401`, network error,
decode error, flag off — degrades to exactly what ships today, with no
layout shift and no empty box. The component API (`{name, domain?,
size?}`) is unchanged.

It layers rather than branches, and that is load-bearing: an earlier
draft tracked load success in `useState`, which made `Avatar` a Client
Component and broke the web build outright, because `packages/shared`'s
barrel is imported by server components. `Avatar` MUST stay JS-free —
it renders a few hundred times on one Senders page.

**The logo layer is a CSS `background-image`, never an `<img>`, and
this is a correctness requirement rather than a styling choice.** The
first implementation used an `<img>` on the stated reasoning that "an
`<img alt="">` that fails paints nothing, so the monogram shows
through". That reasoning was wrong, and shipped: Chromium paints a
broken-image placeholder for a failed image that has been given
dimensions, and the layer additionally carried an opaque background
that covered the monogram whether or not any bytes arrived. Because
`204` is the answer for every uncached domain — i.e. every domain on
first render — the live result was a page of broken-image glyphs on
blank tiles, which is precisely the "empty box" this section forbids.
A failed CSS background image has no placeholder in any engine.

Two constraints follow, and both must hold:

1. The layer carries **no background-color of its own**. Covering the
   monogram is the mark's own job — BIMI SVG Tiny PS forbids
   transparency, so a verified mark is an opaque tile. A
   spec-violating mark shows the initial faintly behind it; that is
   cosmetic, not a broken box.
2. `loading="lazy"` has no background-image equivalent, so it is lost.
   Senders loads 50 rows at a time and requests are conditional
   (strong ETag → `304`), which is the price of a safe failure path.

Markup assertions cannot see any of this — the broken version passed
them. The guarantee is therefore asserted in a real engine by
`packages/e2e/specs/render-avatar-logo.spec.ts` (CI project `render`),
which screenshots the avatar, deletes the logo layer, and requires the
two shots to be byte-identical on `204`/`401`/connection-refused and to
differ on a cached mark.

Below 24px (table rows) `Avatar` stays monogram-only: downscaled marks
are where mixed fidelity looks worst, and the identity anchor is
already doing its job there.

### 7. Behind `brandLogos`, defaulting on

ADR-0025 manifest row. It landed `false` while VMC verification was
still an open question; with §4a built, the condition that justified
keeping it dark is gone, so it defaults `true`. It remains a
kill-switch: one env var turns every avatar back into a monogram
without a revert.

## Consequences

### Positive

- Zero third-party requests from the browser — ADR-0024's privacy win
  is fully preserved, and Phase 1 adds no third party at all.
- One fetch per domain product-wide means a vendor (if Phase 2 ever
  lands) sees a slow trickle of distinct domains with no volume, no
  timing, and no user attribution — it cannot distinguish one user from
  ten thousand.
- Recognizable marks return for the brands users actually recognize,
  without reintroducing page-level fidelity variance.
- No new runtime dependency: BIMI is SVG, so no `sharp`, no raster
  pipeline.

### Negative

- Requiring a verified VMC cuts coverage further: a brand that
  publishes BIMI without a certificate gets no logo. That narrows the
  set to brands that paid for trademark verification — which is the
  point, and happens to be the set users recognise, but it is a real
  reduction against BIMI-only.
- Each resolution is now two outbound fetches (logo, then certificate)
  rather than one. Still once per domain for the whole product.
- BIMI coverage is real but partial — long-tail senders stay monograms.
  That is the intended steady state, not a gap to close.
- `bytea` images inflate database dumps. At the projected ceiling
  (~600MB worst case, realistically far less) this is immaterial; past
  a few GB, moving bytes to object storage is the migration, and it is
  contained because the API contract is unchanged either way.
- A new outbound-fetch surface exists, with the SSRF guard as its only
  protection. That guard is security-critical code and is tested as
  such.

### Neutral

- `Avatar`'s public API and `aria-hidden` contract are unchanged.
- The monogram tint system stays exactly as ADR-0024 specified; logos
  ride on top of it rather than replacing it.

## Alternatives considered

- **Vendor-first (Brandfetch / Logo.dev) as Phase 1.** Rejected for the
  landing PR: it needs an account, a bill, attribution terms, and a
  privacy-note amendment, all to answer a question — "is coverage good
  enough to matter?" — that BIMI answers for free. Deferred, not dead.
- **Per-user or per-mailbox icon rows.** Rejected: builds a
  correspondent index, which is the exact artifact the privacy posture
  denies holding. Also multiplies fetches by userbase for no benefit,
  since logos have no user-specific variant.
- **Blocking fetch on cache miss.** Rejected: couples render latency to
  a third party's DNS and TLS. The 204 + background-fetch contract
  makes a cold domain indistinguishable from a logo-less one at render
  time.
- **Object storage for the bytes.** Rejected for now: at ~4KB/row it
  adds a client, credentials, a second backup surface, and a
  bucket/database consistency failure mode for no gain.
- **Bundled top-N logo pack.** Rejected (unchanged from ADR-0024): ages
  badly, bloats the bundle, and still monograms the long tail — so
  page-level mixing returns anyway.

## Verification

- `packages/workers/src/domain-icon.worker.test.ts` — cascade order,
  negative caching, TTL refresh, idempotency on domain.
- `packages/workers/src/vmc-verifier.test.ts` — run against a REAL
  OpenSSL-generated chain (`src/__fixtures__/vmc/`), not mocks: a valid
  VMC is accepted, and each of the attacks is refused — a certificate
  that is not a VMC, a genuine VMC replayed against another domain, a
  VMC serving artwork it does not commit to, and a chain signed by an
  untrusted CA. Also asserts the fixture chain does NOT verify against
  the real public trust store, which guards the injected-anchors seam.
- `packages/workers/src/bimi-resolver.test.ts` — SSRF guard rejects
  private/loopback/link-local/CGNAT targets and redirects into them;
  http scheme, oversize body, wrong content-type, and script-bearing
  SVG all rejected.
- `apps/api/src/icons/icons.controller.spec.ts` — 200/204/enqueue
  matrix, ETag revalidation, no auth requirement, rate limit applied.
- `packages/e2e/specs/render-avatar-logo.spec.ts` — in Chromium: a
  `204`, a `401` and a refused connection each paint NOTHING over the
  monogram, and a cached mark paints and covers it. The assertion that
  the shipped-broken version fails.
- `packages/shared/src/components/avatar.test.tsx` — monogram base
  layer present in markup; layer carries no background-color and emits
  no `<img>`; monogram-only under 24px; flag off renders zero network
  surface. Markup-level only — see the spec above for paint.
- Schema check: `domain_icons` has no column referencing a user or
  mailbox (asserted in the schema test).
