# Static marketing rendering vs the nonce CSP — a decision for the founder

**Date:** 2026-08-14 · **Status:** **RULED — Option A approved (founder,
2026-08-14).** Implementation pending; §1's measured facts and §5's verification
plan remain the contract.

**The ruling, in full.** The `(marketing)` subtree may run **without**
`strict-dynamic`, using `'self'` + a hash for `/theme-init.js`. `(app)` keeps
the strict nonce CSP **unchanged**. `/pricing` **stays dynamic** so its INR/USD
region pricing stays correct. Options B and C below are retained as decision
history — do not implement them.
**Relates to:** D175 (strict nonce CSP), D160 (Lighthouse ≥90 on marketing),
D128 (canonical origin)

---

## 1. The measured facts

All verified on this branch, not inferred.

**Not one HTML page is prerendered.** `apps/web/.next/prerender-manifest.json`
after `pnpm --filter @declutrmail/web build` contains **8 routes, all of them
metadata assets** — `favicon.ico`, `icon.svg`, `apple-icon.png`, `robots.txt`,
`opengraph-image`, `manifest.webmanifest`, the inbox-simulator OG card,
`sitemap.xml` — and `"dynamicRoutes": {}`. `find .next/server/app -name '*.html'`
returns zero files.

**The build's route table is misleading on this point.** It marks
`/blog/[slug]` and `/vs/[competitor]` as `●` (SSG) because they declare
`generateStaticParams` with `dynamicParams = false`. Those declarations run —
"Generating static pages (71/71)" — but no HTML is emitted for them, and they
appear in neither manifest. Reading the `●` as "these ten pages are static"
would be wrong; the prerender manifest is the authority.

**Two reads force this, not one.** Both in `apps/web/src/app/layout.tsx`:

| Line  | Read                                 | Why it exists                           |
| ----- | ------------------------------------ | --------------------------------------- |
| `:48` | `(await headers()).get('x-nonce')`   | The per-request CSP nonce (D175)        |
| `:55` | `requestHeaders.get(COUNTRY_HEADER)` | Billing rail → INR vs USD prices (D117) |

Either alone opts **every route in the app** out of static generation. Both
must go for the `(marketing)` subtree to prerender.

**The nonce read is deliberate and documented**, at `layout.tsx:39-47`:
_"Reading `headers()` here opts every route out of static prerendering, so no
page can ever ship build-time HTML whose inline bootstrap scripts carry a stale
(or missing) nonce."_ This is a considered trade, not an oversight. That is
exactly why it is a founder call.

**What consumes the nonce.** Only one explicit consumer in JSX —
`<script src="/theme-init.js" nonce={nonce}>` at `layout.tsx:78` — plus Next's
own framework bootstrap scripts, which Next nonces automatically by reading the
`Content-Security-Policy` **request** header the middleware sets
(`middleware.ts:236-237`), and only while rendering dynamically.

**Why an external same-origin script still needs the nonce.** `script-src` is
`'self' 'nonce-…' 'strict-dynamic'` (`middleware.ts:113-135`). Under
`strict-dynamic`, **host-source expressions are ignored** — `'self'` stops
authorizing anything. So `/theme-init.js`, despite being same-origin and
static, executes only because it carries the nonce. Prerender the page and the
nonce is absent or stale: the theme script and the Next bootstrap are both
refused, and the page ships dead.

**One marketing page has a genuine per-request dependency.** `/pricing`
consumes `useRegionProvider` (`pricing-screen.tsx:9`, `tier-card.tsx:9`) to
quote INR or USD. The other 33 public routes have no per-request input at all.

**What it costs today.** Every visitor and every crawler hit on all 34 public
routes is a Node function invocation. No ISR, no `revalidate`, no HTML
`Cache-Control` anywhere in the repo. For a Show HN / Product Hunt spike this is
the difference between a CDN serving bytes and a function pool serving renders.

---

## 2. The options

### Option A — Split the CSP by subtree (recommended)

Middleware keeps minting a nonce for `(app)` routes and stops for
`(marketing)` ones, choosing by pathname; the marketing subtree gets a
`script-src` that does not need per-request state.

- **Files:** `middleware.ts` (pathname branch in `buildContentSecurityPolicy`),
  `app/layout.tsx` (move the `headers()` read out of the root), a
  `(marketing)/layout.tsx` that renders the theme script without a nonce, and
  an `(app)` layout that keeps the current behaviour.
- **CSP kept for `(app)`:** unchanged — nonce + `strict-dynamic`.
- **CSP for `(marketing)`:** drops `strict-dynamic` and `'nonce-…'`, falling
  back to `'self'` plus a **hash** for `/theme-init.js`. Weaker than the app
  subtree in theory. In practice the marketing subtree renders no
  user-controlled content, has no authenticated session, and loads no
  third-party scripts, so the injection surface it protects against is close to
  empty.
- **Effort:** M. The fiddly part is the theme-script hash staying in sync with
  the file; a build-time hash or a test that recomputes it closes that.
- **Result:** 33 routes prerender. `/pricing` stays dynamic unless its currency
  moves client-side (see below).

### Option B — Keep one CSP, move the nonce to a client boundary

Stop reading `headers()` in the root layout; let the middleware set the CSP
response header only, and drop `/theme-init.js` in favour of a
no-JS-needed theme strategy (e.g. CSS `prefers-color-scheme` for first paint
with the stored preference applied after hydration).

- **Files:** `layout.tsx`, `public/theme-init.js` (deleted), whatever reads the
  stored preference.
- **CSP:** unchanged and strict everywhere — this is the only option that keeps
  `strict-dynamic` on the marketing subtree.
- **Cost:** reintroduces a theme flash for users whose stored preference
  differs from their OS setting. That is precisely what the parser-blocking
  script exists to prevent (`layout.tsx:77`).
- **Effort:** M, and it trades a security-neutral win for a visible regression.

### Option C — Do nothing, buy the headroom elsewhere

Leave rendering dynamic and absorb a launch spike with Vercel function scaling.

- **Effort:** zero. **Risk:** the cost and latency profile of a front-page spike
  is untested, and there is no HTML cache to fall back on.

---

## 3. Recommendation

**Option A**, with `/pricing` left dynamic for now.

The reasoning is that the two subtrees have genuinely different threat models,
and the current design charges the marketing subtree the full price of the app
subtree's protection. `strict-dynamic` earns its keep where there is a session
to steal and user-influenced content to inject; the public pages have neither.
Option B is the only one that keeps CSP strength uniform, but it pays for that
with a theme flash on every cold load — a real, visible regression traded for a
threat the marketing subtree does not face.

`/pricing` should stay dynamic rather than have its currency resolved on the
client: moving it client-side would flash the wrong price, and quoting the wrong
currency on the page where someone decides to pay is worse than one dynamic
route.

---

## 4. What the founder is being asked to approve

1. That the `(marketing)` subtree may run **without** `strict-dynamic`, using
   `'self'` + a hash for the one static script.
2. That `(app)` keeps the current strict nonce CSP unchanged.
3. That `/pricing` stays dynamic so its region pricing stays correct.

If any of those is a no, Option B or C is the fallback and the Lighthouse half
of D160 should be scoped accordingly.

---

## 5. Verification, once a ruling exists

- `pnpm --filter @declutrmail/web build`, then assert
  `.next/prerender-manifest.json` lists the 33 marketing routes and
  `find .next/server/app -name '*.html'` returns them. **Read the manifest, not
  the `○●ƒ` column** — §1 is why.
- `curl -I` a marketing URL and an app URL: both must still carry
  `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `Strict-Transport-Security`, `X-Frame-Options`. The app
  response must still carry a nonce; the marketing response must not.
- Load a marketing page with the browser console open and confirm **no CSP
  violation** is reported — that is the check that proves the theme script and
  the Next bootstrap both still execute.
- Re-run `pnpm check:bundle` and the public a11y lane; neither should move.
- Confirm the theme still resolves before first paint (no flash) in both
  themes, which is the thing Option A is specifically preserving.

---

## 6. Not in scope here, but adjacent

`middleware.ts:263-276` matches everything except `_next/static`, `_next/image`
and `favicon.ico`, so `robots.txt`, `sitemap.xml`, `llms.txt`,
`manifest.webmanifest`, the OG image routes and every `/public` asset each mint
a UUID nonce and build a CSP string. Narrowing that is a straightforward perf
win, but it also decides which responses stop carrying `nosniff` and the rest of
the static header set — a security-headers change, and the same §9 stop
condition. It should ride along with whichever option is chosen, as an explicit
decision rather than a side effect.
