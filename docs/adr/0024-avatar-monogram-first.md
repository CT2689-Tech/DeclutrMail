# ADR-0024: Sender avatars are monogram-first; brand logos deferred behind a first-party proxy

- **Status:** Accepted
- **Date:** 2026-07-03
- **Deciders:** chintan.a.thakkar@gmail.com
- **Related D-decisions:** D1/D2 (Geist + cool/editorial palette), D7/D228
  (privacy posture — the trust wedge), D227 (canonical verbs, unaffected)
- **Related ADRs:** ADR-0016 (senders visual language — A3 accent map),
  ADR-0019 (verb registry / ActionPopover)

## Context

The shared `Avatar` rendered a 3-tier third-party favicon waterfall:
Clearbit Logo API → DuckDuckGo icons → Google S2 favicons → colored
initial bubble. Founder review (2026-07-03) flagged the result as
un-premium; audit found two structural problems:

1. **Privacy.** Every rendered sender fired that sender's brand domain
   to up to three third parties, from the user's browser, with the
   user's IP attached. The Senders page markets "we store sender,
   subject, snippet — never bodies" while the same page broadcast the
   user's correspondent list to Clearbit, DuckDuckGo, and Google. Not
   a D7 storage violation, but a metadata leak squarely against the
   trust wedge.
2. **Perceived quality.** Mixed sources produced page-level variance —
   high-res transparent brand PNGs beside upscaled 16px favicons
   beside saturated letter bubbles, in two different silhouettes
   (white chip + border vs solid color fill). The saturated
   `avatarColors` fills (violet `#7C3AED`, red `#DC2626`, greens) sat
   outside the ADR-0016 A3 accent map. Inconsistency reads as cheap;
   uniformity reads as premium (the Linear/Vercel monogram pattern).

Secondary: the waterfall cost 1–3 sequential 404 round-trips per new
domain per session, and `sender-table` rows rendered no avatar at all
— the identity anchor vanished on the Grid↔Table toggle.

## Decision

1. **Monogram-only `Avatar`.** One silhouette everywhere: rounded
   square, `color.border` hairline, single initial (Geist Mono 500) on
   a deterministic muted tint. Tint = djb2 hash of the brand-level
   root domain (bulk-mail prefixes stripped: `mail1.brand.com` →
   `brand.com`; falls back to display name) → hue at fixed
   `30%/94%` (bg) and `26%/34%` (fg) — always inside the D2 cool
   palette. No network I/O of any kind. `avatarColors` is retired
   from tokens.
2. **Table rows gain the same monogram** (22px) in the Sender cell so
   both list views anchor identity identically.
3. **Brand logos are DEFERRED, not banned.** If logos return, they load
   exclusively through a first-party `GET /api/icons/:domain` proxy
   (server-side fetch + cache + ≥64px quality gate, monogram
   fallback), so no user browser ever talks to an icon vendor. That
   endpoint is its own PR + privacy-auditor review; nothing in this
   ADR blocks it.

## Consequences

### Positive

- Zero third-party requests from sender surfaces — the trust-wedge
  contradiction is gone, and so are the waterfall's 404 round-trips.
- Page-level visual coherence: one avatar silhouette, one tint system,
  all hues palette-interior. Stable identity per brand across
  subdomains, sessions, and surfaces (card, table, detail, triage,
  screener, activity, review session).
- `Avatar` is now a pure synchronous component — no state, no effects,
  no `img` error churn during fast scrolls.

### Negative

- Recognizable brand marks (the ~90% Clearbit hit rate) are gone until
  the proxy tier ships. Monograms carry less instant recognition for
  household brands.
- Any screenshot/marketing asset showing old logo avatars is stale.

### Neutral

- Component API unchanged (`{name, domain?, size?}`) — zero call-site
  changes beyond the table's new usage.
- `aria-hidden` contract unchanged (name text always adjacent).

## Alternatives considered

- **Keep waterfall, add a consent toggle.** Rejected: a privacy toggle
  for decorative logos is settings noise, and default-on keeps the
  leak while default-off keeps the inconsistency.
- **Proxy the waterfall now.** Rejected for this pass: server-side
  fetching + caching + quality gating is real scope (rate limits,
  cache invalidation, GCS/edge storage) for a decorative payoff;
  monograms deliver the consistency win today. Deferred, not dead.
- **Self-hosted icon pack (top-N brands).** Rejected: a bundled logo
  set ages badly, bloats the bundle, and still monograms the long
  tail — page-level mixing returns.

## Verification

- `packages/shared/src/components/avatar.test.tsx` — asserts no
  `<img>`/vendor URL surface, deterministic tint across bulk-mail
  subdomains, distinct tints per domain, initial fallbacks,
  `aria-hidden`.
- Manual smoke (dev login): grid cards, table rows, detail header,
  review session all render monograms; DevTools network panel shows
  zero requests to `clearbit.com`, `duckduckgo.com`, `google.com/s2`.
