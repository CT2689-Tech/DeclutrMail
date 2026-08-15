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

| cache state | response                                                    |
| ----------- | ----------------------------------------------------------- |
| `ok`        | `200 image/svg+xml` + strong ETag + immutable cache headers |
| `none`      | `204`                                                       |
| absent      | `204`, and enqueue a fetch job                              |

`204` is the contract for "monogram, and we're on it" — not an error. A
cold domain costs a render nothing.

The route is **authenticated**, despite returning no user data. An
earlier draft of this ADR left it open on the reasoning that public
brand artwork needs no guard; that was wrong on two counts, both about
what an anonymous caller could do rather than what they could read. A
miss ENQUEUES an outbound resolution, so an open route lets a stranger
drive our DNS and HTTPS fetches at domains of their choosing and fill
our cache table doing it; and the cache is a global set of domains our
users receive mail from, which anonymous probing turns into an oracle
for that set. Cookies reach it from an `<img>` because API and web
share a registrable domain, so the `SameSite=Lax` session cookie is
sent on the subresource request. If it ever is not, icons 401 and the
UI shows monograms — the same floor as every other failure.

### 4. Resolution cascade, server-side only

`DomainIconWorker` (`batchPolicy`, idempotency key = domain, so a
thousand concurrent misses collapse to one job):

1. **BIMI** — DNS TXT `default._bimi.<domain>`, parse the `l=` URL.
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
references) before storage. It is served exclusively for `<img>`
rendering, where script execution is inert regardless.

### 6. Monogram is the floor, never a fallback that can fail

`Avatar` renders the monogram as its base layer **always**, and layers
an `<img>` over it. Every failure mode — `204`, `401`, network error,
decode error, flag off — degrades to exactly what ships today, with no
layout shift and no empty box. The component API (`{name, domain?,
size?}`) is unchanged.

It layers rather than branches, and that is load-bearing: an earlier
draft tracked load success in `useState` to fade the logo in, which
made `Avatar` a Client Component and broke the web build outright,
because `packages/shared`'s barrel is imported by server components.
An `<img alt="">` that fails paints nothing, so the monogram beneath
shows through with no state at all. `Avatar` MUST stay JS-free — it
renders a few hundred times on one Senders page.

Below 24px (table rows) `Avatar` stays monogram-only: downscaled marks
are where mixed fidelity looks worst, and the identity anchor is
already doing its job there.

### 7. Behind `brandLogos`, defaulting off

ADR-0025 manifest row, default `false` for the landing PR. It makes
outbound network calls on a new path; it earns a smoke on real data
before it is on by default. Flipping is a one-value change plus a
Vercel env var.

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
- `packages/workers/src/bimi-resolver.test.ts` — SSRF guard rejects
  private/loopback/link-local/CGNAT targets and redirects into them;
  http scheme, oversize body, wrong content-type, and script-bearing
  SVG all rejected.
- `apps/api/src/icons/icons.controller.spec.ts` — 200/204/enqueue
  matrix, ETag revalidation, no auth requirement, rate limit applied.
- `packages/shared/src/components/avatar.test.tsx` — monogram base
  layer survives every img failure mode; monogram-only under 24px; flag
  off renders zero network surface.
- Schema check: `domain_icons` has no column referencing a user or
  mailbox (asserted in the schema test).
