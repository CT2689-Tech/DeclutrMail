# CLAUDE.md — DeclutrMail v2

## Project Overview

DeclutrMail is an email cleanup SaaS product. This repository is the **v2 ground-up rebuild** — a fresh React SPA that connects to a Supabase backend with Edge Functions. The build philosophy is **one feature at a time**, end-to-end (UI route + edge function + DB migration + tests + design pixel-match), each feature shippable on its own.

v1 (the legacy implementation) lives at a separate repo and is used only as **read-only behavioral reference**.

## Tech Stack (seed)

The seed scaffold ships the minimum to render a real React app with the v2 editorial design system. Dependencies are added per-feature, not speculatively.

- **Framework**: React 18 + TypeScript 5.8
- **Build Tool**: Vite 7 (ESM)
- **Styling**: Tailwind CSS 3 (with the v2 editorial vocabulary + semantic tokens)
- **Routing**: React Router v6 (BrowserRouter)
- **SEO meta**: react-helmet-async
- **Testing**: Vitest + React Testing Library + jest-dom matchers
- **Linting**: ESLint 9 flat config + jsx-a11y + react-hooks + testing-library + jest-dom
- **Formatting**: Prettier
- **Pre-commit**: Husky 9 + lint-staged

Deferred (each lands with the feature that needs it):

- **Backend client**: `@supabase/supabase-js` — first feature with persisted state
- **Data fetching**: `@tanstack/react-query` — first feature with server data
- **Form handling**: `react-hook-form` + `zod` — first feature with forms
- **Animations**: `framer-motion` — first feature that demands them
- **Component primitives**: `@radix-ui/*` (shadcn-style) — first feature that needs accessible interactive primitives
- **Monitoring**: `@sentry/react`, `@vercel/analytics`, web-vitals — Phase 5 polish
- **Marketing SEO**: `@prerenderer/rollup-plugin`, `puppeteer`, `@sparticuz/chromium` — when marketing routes ship
- **MDX content**: `@mdx-js/*` — when blog/guides land
- **Payments**: Paddle / Razorpay SDKs — billing feature
- **E2E**: `@playwright/test`, `@axe-core/playwright` — first end-to-end happy-path

## Commands

```bash
npm run dev            # Start dev server (port 5173)
npm run build          # Production build
npm run preview        # Preview production build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier write
npm run test           # Vitest (single run)
npm run test:watch     # Vitest watch
npm run test:coverage  # Vitest with v8 coverage
```

### Pre-commit hook

`npm run prepare` (auto-run on `npm install`) registers Husky. The `.husky/pre-commit` hook runs `lint-staged` which applies `eslint --fix` then `prettier --write` to staged `.ts`/`.tsx`/`.js`/`.mjs`/`.cjs` files, and `prettier --write` to staged `.json`/`.css`/`.md`. **Never use `--no-verify`.** If a hook fails, fix the underlying issue and create a NEW commit (do not amend — pre-commit failure means the commit didn't happen, so `--amend` would target the wrong commit).

## Path Aliases

- `@/*` → `./src/*` (configured in `tsconfig.json`, `tsconfig.app.json`, and `vite.config.ts`)

## v1 Reference Path

The legacy v1 implementation lives at:

- **Local path**: `/Users/chintant/projects/declutr-front-zen`
- **GitHub**: `CT2689-Tech/declutr-front-zen`

It is **read-only behavioral reference**. Never write to it from this project.

When porting a feature:

1. Read the equivalent v1 implementation to extract edge cases (the "Bug:" protocol lessons, the React Query gotchas, the "Design Gotchas" v1's CLAUDE.md spelled out — they were paid for in real bugs).
2. Read the v2 design source at `/tmp/declutr-design/declutrmail-design-system/project/` — specifically `ui_kits/product/v2/screens/<screen>.jsx` and `ui_kits/product/v2/lib/api-catalog.jsx` for the relevant entry.
3. Implement clean here. **Do not carry over v1 quirks** unless they were genuine edge-case fixes for real bugs (calendar invites in travel, sync-status race conditions, placeholderData traps).

Inspecting v1 from this project:

```bash
# Read a v1 file
Read /Users/chintant/projects/declutr-front-zen/src/pages/<File>.tsx

# Inspect v1 git history
git -C /Users/chintant/projects/declutr-front-zen log --oneline -10
git -C /Users/chintant/projects/declutr-front-zen show <sha>

# Grep across v1
grep -rn "<pattern>" /Users/chintant/projects/declutr-front-zen/src
```

## Design Source

The Claude Design handoff bundle is at:

- **Local**: `/tmp/declutr-design/declutrmail-design-system/`
- **Original URL**: `https://api.anthropic.com/v1/design/h/6WR5Q3o0DFEIe-b3iENBXw`

Key reference docs in the bundle:

- `project/Hand off to Claude Code.html` — master index
- `project/Next session handoff.html` — five-phase rollout plan, design ↔ existing-code mapping, first 10 PRs (for v1; ignore for v2 fresh build, useful for scope)
- `project/Performance and unified checkout notes.html` — perf targets, unified Razorpay/Paddle schema
- `project/Product punch list.html` — six audit passes, 33/33 items closed
- `project/colors_and_type.css` — design tokens (already ported to `src/index.css`)
- `project/ui_kits/product/v2/screens/*.jsx` — 13 product screens (canonical layouts)
- `project/ui_kits/product/v2/lib/api-catalog.jsx` — per-screen backend contract (queries, mutations, realtime events, schema changes, LLM use)
- `project/ui_kits/product/v2/lib/brief-prompt.md` — exact prompt + token budget for the daily-brief Edge Function
- `project/ui_kits/product/v2/lib/primitives.jsx` — React component primitives (DV\* atoms; partially ported into `src/components/brand/`)
- `project/ui_kits/product/v2/marketing/v2-marketing.css` — marketing-page editorial vocabulary (the `.tiers`, `.qa`, `.cmp`, `.masthead` classes ported to `src/index.css`)

Per the design's own README in the bundle, `_archive/` should be ignored.

## Architecture Patterns (current seed)

### Provider Hierarchy (current — minimal)

```
HelmetProvider → BrowserRouter → Routes
```

Each feature that lands adds providers as needed (Auth, QueryClient, Theme, etc.) — none added speculatively.

### Component Conventions

- Feature components grouped by domain under `src/components/<feature>/`
- Brand atoms in `src/components/brand/` (editorial vocabulary; marketing-only — see Design Gotchas)
- Page components in `src/pages/<route>/` once they exist (none yet — first feature creates the first route)

## Working Discipline

Three rules that apply to every task, not just bugs:

1. **State assumptions before coding.** If the ask is ambiguous, name the ambiguity and pick one interpretation _explicitly_ — don't silently choose. If a simpler approach exists, say so before implementing the harder one.
2. **Every changed line must trace to the request.** Don't "improve" adjacent code, reformat untouched files, or refactor things that aren't broken. If you notice unrelated dead code or smells, mention them — don't delete them. Clean up only orphans YOUR changes created (unused imports, now-dead variables).
3. **Convert the ask into a verifiable goal before starting.** "Add X" → "X is wired up and clicking the button shows Y". "Fix bug" → follow the Bug: protocol. "Refactor Z" → "tests pass before and after, no behavior change". Weak success criteria ("make it work") produce wandering diffs.

### Implementation discipline

- **Delete legacy when your changes orphan it.** When renaming a route/page/component, the old file is deleted in the same PR. Imports, query keys, route entries, sidebar items — all swept together. Aliases live as 301 redirects on the _route_, not as preserved files in `src/`. Pre-existing dead code unrelated to your change: mention it, don't delete it (that's a separate cleanup PR).
- **Length discipline.** If your change is 200 lines where 50 would do, rewrite. If a ported design screen comes out >2× the source `.jsx`'s line count, the port is over-engineered — rewrite.
- **Match existing style, even if you'd do it differently.** Local style consistency beats global style preferences. If a directory uses `function Foo()` exports, your new component uses `function Foo()` exports, not `const Foo = () => {}`.
- **No band-aid on data bugs (restated for surface work).** Already in Bug Fix Quality Standards; restated here so it applies to feature/refactor PRs too. UI guards (`?.`, `if (!data) return null`) are defense-in-depth only — the data source must be correct first.
- **One feature at a time.** This is the v2 build philosophy. A feature is end-to-end (UI route + edge function + DB migration + tests + design pixel-match). Don't pre-build foundation that no feature uses; don't bundle two features into one PR.

## Bug Fix Quality Standards

- **Root cause first**: NEVER propose fixes without tracing the full data flow. Symptom fixes create new bugs.
- **No band-aids on data bugs**: When a UI value is wrong/null/missing, trace the full data pipeline (API → edge function → DB write → DB read → frontend) to find where the data breaks. Hiding/guarding the UI component is not a fix — it masks the root cause. Fix the data source, then add the UI guard as defense-in-depth.
- **No hacky solutions**: If you don't fully understand the root cause, say so. Don't guess-and-check.
- **End-to-end edge cases**: When fixing filter/pill/pagination behavior, verify ALL transitions (filtered→unfiltered, cached→uncached, placeholder→real data, empty→populated, back-to-back rapid switches).
- **Run typecheck + tests before AND after**: `npm run typecheck && npm run test` — confirm no regressions.
- **One fix, one concern**: Don't bundle unrelated changes. Each fix should address one root cause.
- **Search for similar patterns**: After fixing any issue, search the entire codebase for the same anti-pattern. Present findings, plan, summary for user approval before implementing additional fixes.

### Verification Evidence Protocol

After any change (fix, feature, refactor, polish), end the response with a "Verification" section that lists the exact commands run and their results. Not "tests pass" — the actual counts and the actual command. This turns completion claims into auditable evidence.

```
### Verification
- `npm run typecheck` → exit 0
- `npm run test` → N passed / M skipped / 0 failed
- `npx eslint <touched files>` → 0 errors, X warnings
```

Scale up as needed: add `npm run build` for build-affecting changes, a browser screenshot for visible UI changes, etc. Scale down only when the change genuinely doesn't touch code (pure docs) — state that explicitly: "No code changed, no verification commands run."

### "Bug:" Prefix Protocol

When a message starts with **"Bug:"** or **"Bug -"**, follow strictly:

1. **Trace the full data pipeline** before writing any code. Map: DB → RPC/query → edge function → API response → frontend hook → component. Identify where the contract breaks.
2. **Fix at the source**, not the symptom. If the backend returns wrong data, fix the backend. If the DB query is wrong, fix the query. Don't patch the frontend to hide bad data.
3. **Backend-first**: If a behavior can be driven/enforced by the backend, do it there. Frontend checks are defense-in-depth, never the primary fix.
4. **Never ship a band-aid**. No `if (!data) return null` to hide a bug. No frontend filtering to compensate for a broken query. No `?.` chains to swallow nulls that shouldn't be null.
5. **Verify the fix eliminates the root cause**, not just the visible symptom. Ask: "If I remove the frontend guard, does the bug still happen?" If yes, the fix is incomplete.

## Design Gotchas (carried forward from v1; verified against v2 design source)

- **Editorial typography is marketing-only.** The Fraunces broadsheet vocabulary (`font-display`, `font-display-italic`, `font-mono-edit`, `editorial-dropcap`, `.tiers`, `.qa`, `.cmp`, `.masthead`, `.strap`, `.twoup`, `.pullquote`, `.code`, and the `<BrandAtom/>`, `<Display/>`, `<Eyebrow/>`, `<PageMast/>`, `<Decision/>`, `<Pill/>` React components when used in their italic-display modes) belongs on public marketing pages — Landing, Pricing, FAQ, Compare, Blog, Guides, Legal, Contact. Product/app surfaces (auth, dashboard, review, undo, settings, billing, errors) use standard product UI patterns (Card/Dialog shells, sans-serif headings, familiar form chrome). On transactional surfaces "common" reads as "trustworthy" and "editorial" reads as "wrong product."
- **`--radius` scale is decoupled from utility primitives.** `--radius: 1rem` for bigger cards/panels (`rounded-lg`). `rounded-md` (6px) and `rounded-sm` (4px) are **pinned** so small primitives (Checkbox, Button, Input) stay visually crisp. **Don't change `sm`/`md` to a `calc()` of `--radius`** — a 20px checkbox with 12px corner radius reads as a circle (radio button). v1 hit this bug; v2 doesn't repeat.
- **Palette discipline: 3 semantic hues.** Primary (brand/active), `--success` emerald (confirmed selection / success), `--warning` amber (caution / pending / streaks). Plus `--destructive` for shadcn primitives and `--danger` for editorial deep-red. **Don't reach for orange, indigo, purple, or pink** — every time someone has, it's gotten removed on the next design pass.
- **One italic accent per marketing page, on the actual differentiator.** Hero `<Display italic>` accents the phrase that names what makes the product different — not generic procedural language. If the italic phrase could appear unchanged on a competitor's page, it's not earning its weight.
- **Single-word eyebrows on top-level marketing routes.** Use the page's own name (`Pricing`, `FAQ`, `Compare`). No articles, no descriptors, no taglines. Em-dashed eyebrows are reserved for in-page section eyebrows below the hero.
- **Hover motion should be pure color, not transform.** On lists of cards, avoid `hover:scale-*` and `hover:-translate-*`. Cursor-driven transforms on a grid create a "disco" effect. Use `hover:border-*` or `hover:bg-muted/*` instead.

## Voice

> 1Password-reassuring + Notion-warm. Calm operator.

Addresses inbox shame. Uses contractions. Never breathless. No exclamation points, no emoji, no urgency timers, no "we miss you" emails. The product's restraint is its differentiation against Sanebox / Clean Email / Unroll.me — every UI decision should make the calmness more visible, not less.

## What's NOT in this repo yet

So future agents don't get confused looking for these:

- No Supabase client (`src/lib/supabaseClient.ts`) — lands with first backend-touching feature
- No Auth provider — lands with auth feature
- No TanStack Query setup — lands with first data-fetching feature
- No shadcn `src/components/ui/` primitives — lands when first interactive component (Button/Checkbox/Dialog) needs them; regenerate via shadcn CLI, never manual-edit
- No `supabase/` directory (migrations, functions, config) — lands when first backend feature is built; new Supabase project provisioned out-of-band by the founder
- No `workers/` directory — lands when Gmail sync / auto-cleanup workers are needed (post first-feature)
- No Sentry/Umami/Vercel Analytics wiring — Phase 5 polish
- No prerendering — lands when marketing routes ship (Phase 2 equivalent in v1's plan)
- No e2e tests — Playwright + axe land with first end-to-end happy-path
