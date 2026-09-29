## 2026-09-27 — The build manifest is not what the browser loads

**Context:** Making the bundle budget count layouts, after #804 cut 4.7-4.8 kB from 16 of 17 signed-in routes' real first load while the budget read +0.03.

**Finding:** `app-build-manifest.json` spreads a route's JS across keys and misses some of it entirely:
- Layouts have keys of their own.
- So do the error, loading, not-found and global-error boundaries. Only the nearest loading boundary loads: /senders/[id] skips its parent's.
- A shared client component rendered from a server component (`next/link`, TanStack's `HydrationBoundary`) resolves to the chunk group of whichever entry bundled it first. So /settings/help loads 14.2 kB of /settings' entry, and seven marketing routes load 7.9 kB of the home page's.

Modelling Next's rules from the manifest matched the served HTML exactly on 41 of 52 routes. The other 11 cannot be known from the manifest. The served HTML (script tags plus the RSC payload's client references) is the complete source, and `next start` plus 52 fetches takes about 2 s.

**Rule (provisional):** To know what a route loads, read what the server sends for it, with redirects not followed. When a manifest-derived number and the served HTML disagree, the HTML wins.

**Distillation trigger:** promote to CLAUDE.md §8 "Performance measurement discipline" if another performance claim is made from a build artifact that the served response contradicts.
