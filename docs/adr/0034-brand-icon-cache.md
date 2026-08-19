# ADR-0034: Brand logos return through a first-party, globally-cached icon endpoint

- **Status:** Accepted
- **Date:** 2026-08-14
- **Amended:** 2026-08-17 (official-site + Brandfetch cached fallback;
  organizational-domain and verified-alias canonicalization);
  2026-08-19 (third-party logo CDNs reconsidered and rejected — see
  §Alternatives reconsidered)
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
2. **BIMI serves SVG, so its tier needs no image processing.** Vector
   scales to every avatar size with no raster normalization. The
   official-site and Brandfetch fallbacks added by the 2026-08-17
   amendments process raster artwork through `sharp`; the BIMI path
   itself remains SVG after sanitization and VMC verification.

## Decision

### 1. One global cache keyed by domain, with no user linkage

`domain_icons` is keyed on the canonical brand domain alone (`chase.com`,
never `alertsp.chase.com` or `temuemail.com`). Canonicalization first uses
the Public Suffix List to find the organizational domain, then applies a
fully verified cross-domain alias when one exists (§4b). It carries **no
`user_id` and no `mailbox_account_id`**.

This is a hard privacy requirement, not an optimization. A per-user
icon table is a queryable index of who receives mail from whom —
precisely the artifact D7/D228 says we do not hold. Keyed on domain
alone, the table is a public-brand-asset cache that happens to have
been populated by domains we saw.

Consequence: one resolution run per domain and TTL **for the entire
product**. If 4,000 users receive mail from Chase, that is one bounded
resolution cascade and 3,999 cache hits. Distinct-domain count grows sublinearly with users
because sender domains follow a hard power law, so the cache improves
as the userbase grows.

### 2. Cache misses are cached

A domain with no discoverable logo is written as `status='none'` with a
TTL, not left absent. Without this, every render of a logo-less sender
re-enqueues a fetch forever — a self-inflicted DDoS, and the most
common way this pattern fails. TTLs: 90d on BIMI/official-site `ok`, 30d
on Brandfetch `ok`, and 30d on `none` (so rebrands and newly-published
BIMI records eventually land while vendor caching stays within terms).

A first-party refresh miss does not immediately erase a known-good mark. The worker
keeps it for one additional 90-day grace window, leaves its original
`fetched_at` intact, and retries after the completed job's 24-hour Redis
tail. This absorbs intermittent WAF 403s and temporarily missing website
metadata without making old branding immortal: after 180 days from the
last successful resolution, another miss converts the row to `none`.
Brandfetch rows get no stale grace: after 30 days the read path schedules
a refresh and renders the monogram until fresh provider artwork lands.
Transient DNS, socket, 408/425/429, and 5xx failures throw and use the
worker retry policy; terminal failed jobs release their dedup key after
one hour, while the durable dead-letter row retains the evidence.
The dead-letter payload allowlist retains only the public canonical
`domain` for this queue, which makes manual replay possible without
linking the failure to a user or mailbox.

### 3. The read path never blocks on an outbound fetch

`GET /api/icons/:domain` answers only from cache:

| cache state | response                                                            |
| ----------- | ------------------------------------------------------------------- |
| `ok`        | `200 image/svg+xml` or `image/png` + strong ETag + hit cache policy |
| `none`      | `204` + `max-age=60`                                                |
| absent      | `204` + `max-age=60`, and enqueue a fetch job                       |

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

### 4a. The BIMI tier stores nothing without a verified VMC

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

**Founder amendment 2026-08-17.** The VMC rule remains absolute for
anything labelled BIMI, but is no longer the only permitted source.
Production sampling found coverage too sparse and, in at least one case,
the surfaced artwork did not match the professional institution mark the
user expected. After BIMI misses, the worker may therefore use artwork
published by the domain's own HTTPS website.

Website artwork is **not identity verification**. A lookalike domain can
publish a copied bank logo, so the UI must never present a website-derived
mark as authenticated, trusted, or proof of sender identity. It is visual
decoration over the existing sender/domain text; phishing protection must
continue to rely on mail authentication and the product's safety paths.

### 4b. Resolution cascade, server-side only

Before resolution, the API derives two domains:

- the **discovery domain**, which preserves the sender-controlled domain
  for exact BIMI lookup; and
- the **canonical domain**, which is the Public-Suffix-List organizational
  domain after a fully verified alias rewrite.

For example, `news.temuemail.com` has discovery domain `temuemail.com` and
canonical domain `temu.com`. `alertsp.chase.com` canonicalizes directly to
`chase.com`, without requiring an alias. Private suffixes are enabled, so
unrelated tenants such as `shop.github.io` do not collapse into one cache
entry.

`brand_domain_aliases` is a global registry of public facts such as
`temuemail.com -> temu.com`. Like `domain_icons`, it has no user or mailbox
link. Automatic rewriting requires `confidence=100`; seeded relationships
must cite official brand documentation. Shared email-service domains must
never be added: an ESP domain can serve unrelated brands, so mapping it
globally would display the wrong logo and poison the cache for every user.

During migration, a valid exact-domain cache hit remains visible while the
canonical row is populated. This avoids turning an already-recognizable
sender back into a monogram merely because its cache key improved.

`DomainIconWorker` (`batchPolicy`, idempotency key = resolver version +
canonical domain, so a thousand concurrent aliases and subdomains collapse
to one job while a new discovery strategy bypasses the old completed job):

1. **BIMI** — DNS TXT `default._bimi.<discovery-domain>`, parse the `l=` URL.
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
2. **Official website** — fetch `https://<canonical-domain>/` (then the bounded
   `www` variant), and try artwork in this order: Apple
   Touch icon, web-app manifest icon, declared standard favicon, explicit
   application tile image, conventional `/apple-touch-icon.png`. Generic
   Open Graph/Twitter images are excluded because a square promotional
   photo is not necessarily a brand mark. Every
   candidate is decoded, quality-gated, stripped of metadata, and
   normalized to an opaque 128×128 PNG. The quality floor accepts a
   32px source (sufficient for the product's 24–40px common display
   sizes) and a 1:2–2:1 aspect ratio, preferring larger square marks but
   showing a usable real logo instead of a monogram when that is all a
   brand publishes. Self-contained SVG favicons pass the same active-
   content and external-reference safety gate as BIMI before being
   rasterized. The entire path uses the same
   public-address pinning and redirect revalidation as BIMI, plus 1 MiB
   image / 2 MiB page ceilings and a true wall-clock request deadline.
   `domain_icon_source='vendor'` is the existing schema's compatibility
   bucket for this non-BIMI raster tier; changing that enum solely for a
   provenance-label rename would require an otherwise unnecessary
   production migration.
3. **Brandfetch Brand API** — only after both first-party tiers miss,
   the worker may query Brandfetch by canonical domain with the
   server-only `BRANDFETCH_API_KEY`. It selects a square raster icon,
   downloads it through the same SSRF guard, and runs the same bounded
   128×128 opaque-PNG normalization. The API credential is attached only
   to the fixed metadata request and is stripped before every redirect;
   it is never sent to an artwork host. `domain_icon_source='brandfetch'`
   preserves provenance so these rows stop serving and refresh at the
   provider's 30-day cache limit. A `401`/`403` is a terminal deployment
   configuration error, while `429`/`5xx` remains retryable and never
   becomes a month-long domain miss.
   This tier is approved for local evaluation only. Brandfetch's current
   general terms make cached delivery subject to a specific written
   agreement; a developer key alone is not that agreement. Production
   must leave the key unbound until that permission and an acceptable
   subscription plan are documented.
4. Neither → `status='none'`.

Every cache row also records the resolver version. A fresh negative
from an older cascade is retried immediately instead of waiting for its
30-day TTL; successful artwork remains valid across resolver upgrades.
The job id carries the same version so BullMQ's retained completion for
the previous strategy cannot suppress that retry.

No user browser ever talks to an icon source. Official-site and Brandfetch
resolution both happen in the worker; the browser reads only DeclutrMail's
first-party cache endpoint. The cache is global by domain, so every user
reuses the same stored bytes rather than causing another provider request.

### 5. The `l=` URL is attacker-controlled — fetch it behind an SSRF guard

The BIMI URL, official-site metadata, and Brandfetch-provided asset URLs come from infrastructure
controlled by whoever owns the sender domain, which includes every
spammer who ever mailed a user. Every fetch therefore requires: `https`
only, DNS resolution with rejection of
private / loopback / link-local / CGNAT / unique-local ranges
(re-checked after every redirect), a redirect cap, a response-size cap,
a wall-clock timeout, and a content-type check appropriate to the tier.

Fetched SVG is validated against the SVG Tiny PS profile shape BIMI
requires and sanitized (no `<script>`, no event handlers, no external
references) before storage. It is rendered exclusively as a CSS
background image (see §6), where script execution is inert regardless.
Website candidates accept PNG, JPEG, WebP, or safely self-contained SVG;
Brandfetch candidates remain raster-only. All are decoded and re-encoded
as PNG before storage, so source metadata and active/non-image payloads
do not survive that boundary.

### 6. Monogram is the floor, never a fallback that can fail

`Avatar` renders the monogram as its base layer **always**, and layers
the mark over it. Every failure mode — `204`, `401`, network error,
decode error, flag off — degrades to exactly what ships today, with no
layout shift and no empty box. The component API (`{name, domain?,
size?}`) is unchanged.

On a successful hit, the stored opaque square extends through the avatar
rim and visually replaces the neutral tile. It is intentionally not inset:
an inset mark creates a generic tile around a second branded tile, while the
product direction is a standalone logo when one exists and a monogram only
when it does not.

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
   transparency, and website raster marks are flattened onto white, so
   a valid stored mark is an opaque tile. A
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
differ on a cached mark. The hit case also asserts that the layer occupies
the avatar's full geometry, preventing the nested-tile treatment from
returning.

Below 24px `Avatar` stays monogram-only: downscaled marks are where
mixed fidelity looks worst. Sender table rows use the 24px floor so a
Grid↔Table switch preserves a cached mark (founder smoke, 2026-08-17).

### 7. Behind `brandLogos`, defaulting on

ADR-0025 manifest row. It landed `false` while VMC verification was
still an open question; with §4a built, the condition that justified
keeping it dark is gone, so it defaults `true`. It remains a
kill-switch: one env var turns every avatar back into a monogram
without a revert.

The worker has a separate server-side kill switch,
`DOMAIN_ICON_WEBSITE_FALLBACK_ENABLED`. Only exact `false` disables
official-site discovery; verified BIMI and already-cached rows continue
to work. Production pins the value explicitly in the Cloud Run deploy
manifest because that manifest full-replaces environment variables.
Brandfetch is independently fail-closed: it is enabled only when the
worker receives `BRANDFETCH_API_KEY`. The API and web services never
receive that secret. The production deploy intentionally does not bind
one until the caching agreement and budget gate above are satisfied.

## Consequences

### Positive

- Zero third-party requests from the browser — ADR-0024's privacy win
  is fully preserved.
- One resolution per domain and TTL product-wide means an official
  website or Brandfetch cannot distinguish one user from ten thousand,
  and subsequent users reuse the same stored bytes.
- Recognizable marks return for the brands users actually recognize,
  without reintroducing page-level fidelity variance.
- Consistent raster output: every website-derived mark is the same
  bounded 128×128 opaque PNG regardless of the source format.
- Lifecycle logs expose only closed `outcome` / `source` values and byte
  counts, so coverage and failure ratios are measurable without logging
  mailbox or user identifiers.

### Negative

- Requiring a verified VMC cuts coverage further: a brand that
  publishes BIMI without a certificate gets no logo. That narrows the
  set to brands that paid for trademark verification — which is the
  point, and happens to be the set users recognise, but it is a real
  reduction against BIMI-only.
- Each resolution is now two outbound fetches (logo, then certificate)
  rather than one. Still once per domain for the whole product.
- BIMI coverage is real but partial — long-tail senders stay monograms.
  Official-site discovery improves that coverage but still intentionally
  falls back to monograms when no usable brand asset exists.
- Website-derived artwork is unverified and can be copied by a lookalike
  domain. The logo is never an authentication signal (§4a).
- `sharp` is now a workers runtime dependency, including its native
  platform package in deployed images.
- `bytea` images inflate database dumps. At the projected ceiling
  (~600MB worst case, realistically far less) this is immaterial; past
  a few GB, moving bytes to object storage is the migration, and it is
  contained because the API contract is unchanged either way.
- A new outbound-fetch surface exists, with the SSRF guard as its only
  protection. That guard is security-critical code and is tested as
  such.
- Brandfetch's free Brand API allowance is 100 brand fetches one-time;
  its current paid tier starts far above the founder's <$20/month target.
  The optional tier therefore improves a prototype or small warm cache,
  but it is not a sustainable full-catalog production source on the free
  plan. Quota exhaustion is fail-soft (monograms), never a broken page.

### Neutral

- `Avatar`'s public API and `aria-hidden` contract are unchanged.
- The premium tonal monogram system stays exactly as amended in
  ADR-0024; logos ride on top of it rather than replacing it.

## Alternatives considered

- **Browser-embedded Logo API (Brandfetch / Logo.dev).** Rejected. Direct
  embedding would send every displayed sender domain plus the user's IP
  and referrer to a vendor and would require a CSP/privacy amendment. The
  Brandfetch public client ID is therefore not used. The authenticated
  server-side Brand API is accepted only as the final tier, behind the
  global first-party cache and the 30-day refresh boundary above.
- **Per-user or per-mailbox icon rows.** Rejected: builds a
  correspondent index, which is the exact artifact the privacy posture
  denies holding. Also multiplies fetches by userbase for no benefit,
  since logos have no user-specific variant.
- **Blocking fetch on cache miss.** Rejected: couples render latency to
  remote brand infrastructure's DNS and TLS. The 204 + background-fetch contract
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
  negative caching, TTL refresh, canonical cache key with exact-domain
  BIMI discovery, and idempotency on domain.
- `packages/shared/src/senders/brand-root.test.ts` — Public-Suffix-List
  organizational domains, including multi-label and private suffixes.
- `packages/db/tests/brand-domain-aliases.test.ts` — official alias seeds,
  confidence/evidence, and absence of user/mailbox linkage.
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
- `packages/workers/src/website-icon-resolver.test.ts` — official-site
  candidate order, lazy manifest fallback, DNS/redirect SSRF rejection,
  byte/quality gates, raster normalization, and transient-vs-cacheable
  failure behavior.
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

## Alternatives reconsidered — hotlinked logo CDNs (2026-08-19)

Production coverage sat at 115 marks for 4,347 sender domains, which
sent us looking at vendors again: LogoKit (5,000 logos/day free) and
Brandfetch's **Logo API** — a different product from the Brand API this
ADR already uses, offering 500,000 requests/month free with no
attribution. Both were rejected. Recording why, because the next person
to find a logo CDN will ask again, and the reasons are not obvious from
the pricing pages.

**Both are hotlink-only by design.** LogoKit answers `403 Programmatic
access is not allowed` to any server-side fetch and documents that
"caching or storing the logo images locally is not supported".
Brandfetch's Logo API states "we require logo links to be directly
embedded in your applications", in an `<img>` tag carrying a `Referer`
header. Neither supports the shape this ADR is built on: fetch once
server-side, store the bytes, serve them from our own origin.

**Privacy — the ADR-0024 reason, unchanged.** Embedding means the
user's browser requests each sender's domain from a vendor, with the
user's IP attached. That is precisely the metadata leak ADR-0024
removed and this ADR was written to keep closed.

**Scaling — a second, independent reason this ADR did not previously
state.** It is the one that decides the question even for a reader who
does not weigh the privacy argument. The distinction is what each
design's traffic is proportional TO:

> Hotlinking scales with **users × page views × senders**.
> Caching scales with **distinct domains × refresh rate** — and is
> independent of how many users there are.

Note what this claim is NOT. It is not "fetch once, forever": this ADR
deliberately expires its own rows, and the numbers matter here.
`DOMAIN_ICON_TTL_DAYS` holds a mark for 90 days so a rebrand lands,
caps Brandfetch-sourced artwork at 30 to stay inside that provider's
terms, and retries a miss after 30. Refresh is demand-driven, so a
domain nobody looks at costs nothing, and a resolver-version bump
retires negatives early on purpose. The steady state is therefore a
refresh cycle, not a single fetch.

That still settles the comparison, because only the LEFT side of each
product grows. Our 4,347 domains bound the work at roughly one refresh
per domain per TTL — and only the Brandfetch-sourced subset touches
that vendor at all, since BIMI and website marks refresh first-party on
the 90-day clock. Whatever that monthly figure is, it does not move
when the tenth user signs up, or the ten-thousandth. Hotlinked, the
same catalogue is re-fetched per user, per device, per browser cache
expiry, and Brandfetch's published throughput ceiling is 2,400 requests
per 5 minutes **per customer** across all of them. One Senders page view issues roughly 50 logo
requests and up to 368 while scrolling, so on the order of twenty
concurrent users browsing senders exhausts it and the vendor returns 429. The failure is graceful — a 429 paints the monogram floor — but
logos would become unreliable exactly as the product grows, which is
the worst possible time for the identity anchor to start flickering.

**Why scraping cannot close the gap either**, and why the Brandfetch
tier is load-bearing rather than a nicety: the brands users see most
are the hardest to scrape. Measured 2026-08-19 — `redfin.com` answers
429 to automated fetches; `linkedin.com` and `amazon.com` serve 200 but
publish no `apple-touch-icon` in server HTML, and Amazon's mark is a
CSS sprite sheet cropped by background-position, so even finding it
yields a sheet of unrelated icons rather than a logo. A site being
well-known correlates with being unscrapable.

**Where that leaves the tiers.** Unchanged. Tiers 1 and 2 stay
first-party. Tier 3 stays the Brandfetch **Brand API**, which permits
server-side fetch and the 30-day cached artwork this ADR already
encodes. If its free quota proves insufficient, the answer is a paid
Brand API plan — buying quota while keeping the architecture — not a
hotlinked CDN, which would trade a cost bounded by the catalogue for
one bounded by the user base.

**Manual curation remains the backstop** for domains no tier can reach,
and it is the only path that is both first-party and unlimited: a
human-supplied URL, fetched once through the same gates, stored like
any other mark.
