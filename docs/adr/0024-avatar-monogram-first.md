# ADR-0024: Sender avatars are monogram-first with a first-party logo layer

- **Status:** Accepted
- **Date:** 2026-07-03
- **Amended:** 2026-08-17 (premium tonal tile)
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

1. **Monogram-first `Avatar`.** One silhouette everywhere: rounded
   square, fine hairline, single initial (Geist Mono 600) on a neutral
   tonal tile. A restrained theme-owned gradient, inset highlight and
   shallow elevation provide depth without another DOM layer or any
   runtime state. Both themes are achromatic: inferred color must not
   imply brand identity, and verified logos are the only avatars that
   introduce brand color. The declared `size` includes the border
   (`border-box`) so a 40px identity anchor occupies exactly 40px.
   `avatarColors` remains retired from tokens.
2. **Table rows gain the same identity anchor** (24px) in the Sender
   cell so both list views preserve the same monogram or cached mark.
3. **Brand logos use the monogram as their floor.** ADR-0034 now
   implements the once-deferred first-party `GET /api/icons/:domain`
   layer (server-side fetch + global cache + quality gate). No user
   browser talks to an icon vendor, and every miss or failed image
   reveals this same intentional monogram without shifting layout. A
   successful opaque mark fills the avatar edge-to-edge, visually replacing
   the tile rather than appearing inside it.

## Consequences

### Positive

- Zero third-party requests from sender surfaces — the trust-wedge
  contradiction is gone, and so are the waterfall's 404 round-trips.
- Page-level visual coherence: one avatar silhouette and one neutral
  fallback treatment in both themes. Stable identity per brand across
  subdomains, sessions, and surfaces (card, table, detail, triage,
  screener, activity, review session).
- `Avatar` is now a pure synchronous component — no state, no effects,
  no `img` error churn during fast scrolls.
- A common neutral surface avoids invented brand color and semantic-status
  confusion, while tonal depth makes a missing-logo monogram feel intentional.

### Negative

- Monograms carry less instant recognition than a successful logo for
  household brands, so they remain visible for cache misses and the
  intentionally unsupported long tail.
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
  subdomains, a neutral surface in both themes, dimensional surface and rim, premium
  typography, initial fallbacks, `aria-hidden`.
- `packages/e2e/specs/render-avatar-logo.spec.ts` — real-browser
  verification at 24/28/40/72px in both themes, plus the logo failure
  states that must reveal the monogram unchanged.
- Manual smoke (dev login): grid cards, table rows, detail header,
  review session all render monograms; DevTools network panel shows
  zero requests to `clearbit.com`, `duckduckgo.com`, `google.com/s2`.
