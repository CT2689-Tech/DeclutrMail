# CLAUDE.md — DeclutrMail

This document is the contract every PR — human or agent — ships against. It encodes what production-ready means for this codebase, the bars each change meets, and how subagents take features end-to-end without quality drift. Agents read it at the start of every session.

## 1. What this is

DeclutrMail is a Gmail cleanup SaaS. Promise to users: we never read email bodies, every action is undoable for 7 days, the voice is a calm operator.

Build model: **one feature at a time, end-to-end.** A feature is a vertical slice (route + data + tests + design match) that ships independently. Foundation grows as features pull it in, not before.

## 2. Tech stack

Today, in this repo:

- React 18 + TypeScript 5.8 + Vite 7
- Tailwind 3 + `@tailwindcss/typography` + `tailwindcss-animate`
- React Router 6 (BrowserRouter)
- `react-helmet-async`
- Vitest 3 + Testing Library + jest-dom + jsdom
- ESLint 9 flat config (typescript-eslint + react-hooks + jsx-a11y + testing-library + jest-dom)
- Prettier 3 + Husky 9 + lint-staged

Added per-feature, not pre-staged:

| Dep                                                | Lands with                                              |
| -------------------------------------------------- | ------------------------------------------------------- |
| `@supabase/supabase-js`                            | First backend-touching feature                          |
| `@tanstack/react-query`                            | First server-state feature                              |
| `@radix-ui/*` (shadcn primitives)                  | First feature needing accessible interactive primitives |
| `react-hook-form` + `zod`                          | First form                                              |
| `framer-motion`                                    | First motion beyond CSS keyframes                       |
| `@sentry/react`, `@vercel/analytics`, `web-vitals` | First production deploy with monitoring                 |
| `@prerenderer/rollup-plugin` + `puppeteer`         | First marketing route                                   |
| Paddle / Razorpay SDKs                             | Billing                                                 |
| `@playwright/test` + `@axe-core/playwright`        | First e2e                                               |
| `@mdx-js/*`                                        | First MDX content (blog / guides)                       |

Don't pre-add. Don't pre-config.

## 3. Commands

```
npm run dev            # vite dev server (5173)
npm run build          # production build
npm run preview        # preview build
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run format         # Prettier write
npm run test           # Vitest (single run)
npm run test:watch     # Vitest watch
npm run test:coverage  # v8 coverage
```

DB / deploy / e2e scripts land with the features that need them.

## 4. Path aliases

`@/*` → `./src/*`. No other aliases until a real cross-package need exists.

## 5. Repository conventions

Folder structure (grows organically; this is the shape it grows _into_):

```
src/
├── App.tsx               Routes only. Logic lives in feature folders.
├── main.tsx              Entry; provider stack.
├── index.css             Tailwind + design tokens + editorial vocabulary.
├── components/
│   ├── brand/            Editorial atoms. Marketing surfaces only.
│   ├── ui/               Shadcn primitives, when first interactive feature needs them.
│   └── <feature>/        Feature-scoped components.
├── lib/
│   ├── utils.ts          Tiny pure helpers (cn, etc.).
│   ├── queryKeys.ts      Centralized React Query keys (when added).
│   └── <domain>/         Domain modules: api/, auth/, etc.
├── pages/
│   └── <route>/          Page components, lazy-loaded.
└── test/
    └── setup.ts          Vitest globals.
```

Naming:

- Components: `PascalCase.tsx`, `export function ComponentName()`
- Hooks: `use-kebab-case.ts`, `export function useCamelCase()`
- Utility files: `kebab-case.ts`
- Types: `PascalCase`, prefer `type` over `interface` unless declaration merging / extending externals is needed

Provider stack — strictly additive as features land. Today:

```
HelmetProvider → BrowserRouter → Routes
```

Each new provider arrives with the first feature that requires it. Never pre-add.

## 6. The definition of done

A feature ships when ALL apply. Subagents that "feel done" without hitting this list are not done.

**UI**

- [ ] Route exists, reachable, lazy-loaded
- [ ] Pixel-matches the design source
- [ ] Keyboard accessible: axe-clean, focus rings visible, tab order correct
- [ ] Responsive at ≤375 / 768 / ≥1280 px
- [ ] Loading, empty, and error states all implemented (not just happy path)
- [ ] `prefers-reduced-motion` respected for every animation

**Data**

- [ ] Edge function deployed, exercisable via curl
- [ ] Migration applied; no table without RLS
- [ ] Query keys centralized; no inline string keys
- [ ] Optimistic UI + rollback for any mutation > 200 ms server round-trip

**Quality**

- [ ] TypeScript: 0 errors. No `any` without an `// @explained: …` comment
- [ ] ESLint: 0 errors on touched files. Warnings only with PR explanation
- [ ] Tests: happy path + ≥ 1 edge case + ≥ 1 error case
- [ ] New-file coverage ≥ 70%
- [ ] Bundle delta ≤ +25 KB gzipped (justify if higher)
- [ ] Lighthouse on the affected route ≥ 90 across P/A/BP/SEO

**Production safety**

- [ ] Error boundary around the route
- [ ] No loading state locks UI > 5 s without explanation copy
- [ ] Error messages name what failed and what the user can do (no "Something went wrong")
- [ ] Privacy oath upheld (see § 8)
- [ ] No `console.log` in committed code; `warn`/`error` only with structured context

**Docs**

- [ ] PR description: what, why, verification commands run
- [ ] `.env.local.example` updated if env vars added
- [ ] CLAUDE.md updated if a quality bar or pattern changed

## 7. Quality bars

These are the numbers. They are the bar, not the aspiration.

**Performance (production)**

- LCP < 2.5 s on 4G throttled mid-tier mobile
- INP < 200 ms
- CLS < 0.1
- Edge function p95: < 200 ms for read paths, < 500 ms for write paths that touch Gmail (with fast-ack)
- Cold start budget: < 500 ms

**Bundle**

- New feature: ≤ +25 KB gzipped JS
- Landing route post-prerender: ≤ 80 KB gzipped initial JS

**Testing**

- New-file coverage ≥ 70%
- Repo-wide thresholds raise as coverage grows; never lower a threshold to make a test green
- Every mutation has an optimistic-rollback test

**Accessibility**

- Lighthouse Accessibility ≥ 95
- 0 axe-core violations on authenticated screens
- WCAG 2.1 AA color contrast on primary text + interactive elements
- Focus rings visible and meet 3:1 contrast
- Reduced-motion alternative for every animated state

**SEO (marketing routes)**

- Lighthouse SEO ≥ 95
- JSON-LD per route
- Real HTML at first byte (prerender)
- OG image present

## 8. Privacy oath

DeclutrMail's promise — every code path enforces it, every UI restates it:

1. **Never reads email bodies.** Gmail metadata scope only. Headers + the same one-line ~160-char preview Gmail shows in list view is the maximum. Models that generate the daily Brief see only sender metadata.
2. **Bodies-read counter.** Settings displays "Bodies read: 0 bytes." The number is verifiably zero. The day it isn't is a P0 incident.
3. **7-day undo on every irreversible action.** Archive, mute, unsub, snooze, brief-archive, autopilot run — all reversible from the activity log for 7 days.
4. **No third-party data egress beyond declared processors.** When an LLM is used, it's named (Anthropic Claude). No analytics provider ever sees email content. No "anonymous data product."
5. **Hard delete on account removal.** All user-derived rows scrubbed from prod within 30 days of account deletion.
6. **Open scopes manifest.** OAuth scopes listed in Settings → Privacy with plain-English explanation and raw scope strings behind a disclosure.

Any feature that pressures these invariants is rejected. Any copy that softens the language ("we don't read bodies for ads" — implies we read for other reasons) is reverted.

## 9. Working discipline

Before writing code:

1. **State assumptions explicitly.** If the ask is ambiguous, name the ambiguity and pick one interpretation. Don't silently choose. If a simpler approach exists, say so first.
2. **Convert tasks into verifiable goals.** "Add X" → "X is wired up; clicking Y triggers Z; the happy-path test passes." Weak success criteria produce wandering diffs.
3. **Match existing style.** Local style consistency over global preferences. If a directory uses `function Foo()` exports, your new file uses `function Foo()` exports.

While writing:

4. **Simplest code that solves the problem.** No speculative features. No abstractions for single-use code. No "flexibility" that wasn't asked for. If 200 lines could be 50, rewrite it.
5. **Every changed line traces to the request.** Don't reformat untouched files. Don't refactor what isn't broken. Clean up only the orphans your changes created.
6. **No band-aids.** Trace the full pipeline before patching at the UI. UI guards (`?.`, `if (!data) return null`) are defense-in-depth — the data source must be correct first.

After writing:

7. **Verify with command output, not vibes.** Every "done" claim ends with the commands run and the actual results. Not "tests pass" — the count. Not "looks good" — the screenshot. Not "the build worked" — the bundle delta.
8. **Delete what you orphan.** Renaming a route → delete the old file in the same PR. Sweep imports, query keys, route entries together. Aliases live as 301 redirects on the route, not as preserved files in `src/`.

## 10. Verification evidence

Every "done" claim ends with:

```
### Verification
- `npm run typecheck` → exit 0
- `npm run test` → N passed / M skipped / 0 failed
- `npm run lint` → 0 errors / X warnings (none in touched files)
- `npm run build` → success; bundle delta +Y KB gzipped
- [feature-specific] curl <endpoint> → 200 with expected shape
- [UI features] screenshot attached vs design source
```

Stale results don't count. If you edited after the last run, run again before claiming.
Pure-docs PRs (no `.ts`/`.tsx`/`.css` touched) state explicitly: "No code changed, no verification commands run."

## 11. Subagent playbook

**When to spawn:**

- Scope is self-contained — the brief fits in one prompt without external memory
- No mutable state shared with concurrent work
- Verification is mechanical (tests, lint, build, screenshot diff)
- Foreground work would otherwise serialize for ≥ 10 turns

**When not to spawn:**

- Requires conversation context to interpret correctly
- Needs follow-up questions back to the user
- Shares mutable state with concurrent work (race risk)
- Verification is subjective (visual taste, copy nuance) — keep foreground

**Brief template — every subagent gets these 5 sections:**

1. **Goal** — one sentence, verifiable outcome
2. **Inputs** — file paths, design source paths, dependencies
3. **Constraints** — what NOT to touch, patterns to match, anti-patterns to avoid
4. **Acceptance** — exact commands the subagent runs to prove done
5. **Reporting** — what to include in the response

Example bad brief: "Build the senders page."
Example good brief: "Implement `src/pages/Senders.tsx` against `/tmp/declutr-design/.../screens/senders.jsx`. Use the existing sender-aggregation query from §X (don't rewrite). Add 4 tests covering happy / empty / filtered / zero-read pill. Acceptance: `npm run typecheck` → 0 errors, `npm run test` → all new tests pass, `npm run build` → bundle delta < +15 KB gzipped. Report: file paths created, test counts, bundle delta."

**Verifying subagent output — trust nothing:**

- Re-run the acceptance commands. Subagents sometimes claim pass when they ran a stale build.
- Diff the files they claim changed. "Intended to" leaks into reports.
- Read test bodies. Names sometimes don't match what's asserted.
- For UI: capture preview, compare against the design source.

**Parallelism is earned:**

- Default to sequential. Each step's output gates the next.
- Parallel only when 2–4 truly independent investigations are needed and the brief inputs don't share state.
- A parallel spawn that creates a merge headache later is a net loss.

## 12. Anti-patterns

Universal NEVER:

- `useEffect` for derived state (compute during render or use `useMemo`)
- Setting state in `useEffect` based on props (lift state or `useMemo`)
- Untyped React refs — write `useRef<HTMLDivElement>(null)`, not `useRef(null)`
- Service-role keys touched from the frontend (server-only via edge functions)
- Raw SQL strings concatenated with user input (parameterize via supabase-js / RPC)
- `console.log` in committed code (use `console.warn` / `console.error` with structured context)
- Silent `catch {}` blocks (catch with logging or rethrow)
- Timeout-based race avoidance (`setTimeout(…, 100)` to "let state settle")
- Prop drilling > 2 levels (lift state, extract context, or pass via slot/render-prop)
- Inline component definitions inside render (creates a fresh identity each render)
- `useState(expensiveInit)` — use the lazy form `useState(() => expensiveInit())`
- Mutating React state in place (`obj.x = 1; setState(obj)` — same reference, won't re-render)
- Pushing directly to `main` (`main` auto-deploys; every change is PR-only)
- `--no-verify` on commits (Husky hooks earn their keep; fix the underlying issue)

Product NEVER:

- Read email bodies in any code path
- Show or log message bodies (headers + 160-char snippet is the maximum)
- Mix marketing editorial typography into product UI surfaces
- Use purple, orange, indigo, or pink in palette decisions
- Add an exclamation point to product copy
- Ship a feature that breaks the privacy oath (§ 8)

## 13. Security baselines

**Database**

- Every table has RLS enabled at creation. Migration adding a table without RLS is rejected.
- Default policies scope by `user_id`. Cross-user access goes through service-role functions, never direct queries.
- Service role key only in edge functions (Deno runtime). Never bundled into the frontend.

**Secrets**

- Frontend env vars are `VITE_*` prefix only. Anything sensitive is _not_ `VITE_*`.
- `.env.local` is git-ignored. `.env.local.example` documents required keys without values.
- Supabase service role + Anthropic API + Paddle/Razorpay secrets live in Supabase Edge Function secrets — never in code.

**OAuth**

- Gmail metadata scope only by default. Any additional scope arrives in a PR that explains why.
- Redirect URIs configured in the Google Cloud client by hand. No env-driven redirect manipulation.

**CSP**

- Default-deny. Allowlist additions go through `vercel.json` with a per-line comment explaining why.
- No `unsafe-inline` in `script-src`. `unsafe-inline` in `style-src` is permitted (Tailwind runtime requires it).
- `frame-ancestors 'none'`. `form-action 'self'`.

**Logs**

- Never log message bodies, snippets, or sender domains paired with body content.
- Email addresses: domain-only in telemetry (`@gmail.com`); never full addresses.
- Sentry breadcrumbs are structured. Redact known-sensitive fields before send.

## 14. Voice

**1Password-reassuring + Notion-warm. Calm operator.**

- Address inbox shame without naming it as shame.
- Use contractions. Be conversational.
- No exclamation points. No emoji in product copy. No urgency timers. No "we miss you" emails.
- Tell users what we do, not how we feel about it.

Examples:

- ✓ "Snoozed Sarah until tomorrow 9 AM. Undo from History anytime."
- ✗ "Don't worry, we've got Sarah's email safely tucked away! 💤"

Restraint is the differentiation. Every UI decision makes the calmness more visible, not less.

## 15. Design system principles

**Editorial typography is marketing-only.**
Marketing routes (Landing, Pricing, Compare, FAQ, Legal, Contact, Blog, Guides) use the Fraunces + Source Serif 4 + JetBrains Mono editorial vocabulary in `src/index.css`. Product app surfaces (Dashboard, Settings, Billing, etc.) use Inter sans + standard Card/Dialog patterns. On transactional surfaces, "common" reads as "trustworthy"; "editorial" reads as "wrong product."

**Three semantic hues plus brand.**
`--primary` (brand teal), `--success` (emerald), `--warning` (amber), `--destructive`/`--danger` (reds). Stay inside this palette. Purple, orange, indigo, pink are outside the system.

**The italic accent earns its place.**
Marketing heroes use one italic Fraunces accent per page, applied to the phrase that names what makes the product different. If the italic phrase could appear unchanged on a competitor's page, it isn't earning the accent.

**Single-word eyebrows on top-level marketing routes.**
`Pricing`, `FAQ`, `Compare`, `Contact`. No articles, no descriptors, no taglines. Em-dashed eyebrows (`— Featured —`) are for in-page section eyebrows below the hero.

**Radius scale is fixed for primitives.**
`rounded-md` (6 px) and `rounded-sm` (4 px) are pinned in `tailwind.config.ts`. They don't compute from `--radius`. Large cards/panels use `rounded-lg` (1 rem). Small primitives stay crisp.

**Motion is color, not transform.**
On card lists, prefer `hover:border-*` / `hover:bg-muted/*` over `hover:scale-*` / `hover:-translate-*`. Cursor-driven transforms across a grid create visual noise.

## 16. PR & commit conventions

**Branch naming**

- Features: `feat/<short-name>`
- Refactors: `refactor/<short-name>`
- Bug fixes: `fix/<short-name>`
- Docs: `docs/<short-name>`
- Chores: `chore/<short-name>`

**Commit messages** — conventional commits, present-tense imperative:

```
feat(auth): wire Google OAuth callback
fix(triage): debounce keyboard handler to avoid double-decide
chore(deps): bump vite to 7.2
refactor(senders): extract row component
docs(claude-md): tighten subagent playbook
```

Co-authored commits include:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**PR description template**

```
## Summary
[1-3 bullets: what + why]

## Verification
- npm run typecheck → [result]
- npm run test → [counts]
- npm run lint → [errors / warnings]
- npm run build → [bundle delta]
- [screenshots or curl per § 6]

## Reviewer notes
[Anything to focus on, or NA]
```

**Size**

- A PR is the smallest unit that meets the feature contract (§ 6).
- If a PR exceeds 600 lines diff (excluding lockfile + design-copied CSS), split.
- Stacked PRs are fine if each layer is independently reviewable.

**`main` is protected**

- Vercel auto-deploys `main` to production. Never push directly.
- Pre-commit hooks (Husky + lint-staged) auto-fix lint + format. Never use `--no-verify`.

## 17. v1 reference

A prior implementation lives at `/Users/chintant/projects/declutr-front-zen` (GitHub: `CT2689-Tech/declutr-front-zen`). **Read-only, not authoritative.**

Consult only when:

- A subagent's brief explicitly asks you to check it for a specific behavioral question.
- An edge case the design source doesn't specify needs a sanity-check answer.

Do not:

- Port v1 patterns "because v1 did it that way."
- Carry v1 file names into v2 unless the design source asks for them.
- Treat v1's CLAUDE.md as a source of truth for v2.

```
# Read v1
Read /Users/chintant/projects/declutr-front-zen/src/pages/<File>.tsx

# Inspect v1 git history
git -C /Users/chintant/projects/declutr-front-zen log --oneline -10

# Grep v1
grep -rn "<pattern>" /Users/chintant/projects/declutr-front-zen/src
```

Never write to v1 from this project.

## 18. Design source

Claude Design handoff bundle: `/tmp/declutr-design/declutrmail-design-system/`. Original URL: `https://api.anthropic.com/v1/design/h/6WR5Q3o0DFEIe-b3iENBXw` (re-fetch if `/tmp` clears).

Per-feature consumption:

- `project/ui_kits/product/v2/screens/<name>.jsx` — canonical layout for screen `<name>`
- `project/ui_kits/product/v2/lib/api-catalog.jsx` — backend contract per screen (queries, mutations, realtime events, schema changes, LLM use)
- `project/ui_kits/product/v2/lib/brief-prompt.md` — Brief feature LLM prompt + token budget
- `project/colors_and_type.css` — design tokens (ported into `src/index.css`)
- `project/ui_kits/product/v2/marketing/*.html` — marketing surface designs

The bundle's `_archive/` is ignored per its own README. The bundle's punch-list / handoff docs are authoritative on v2 design decisions; sections about v1 migration are historical context only.

## 19. What's NOT in this repo yet

So agents don't look for things that haven't shipped:

- No Supabase client — lands with first backend feature
- No Auth provider — lands with auth feature
- No TanStack Query setup — lands with first data feature
- No shadcn `src/components/ui/` primitives — lands with first interactive component
- No `supabase/` directory (migrations, edge functions, config) — lands with first backend feature; new Supabase project provisioned out-of-band
- No `workers/` directory — lands when first background worker is needed
- No Sentry / Umami / Vercel Analytics — Phase 5 polish
- No prerendering — lands with first marketing route
- No e2e tests — lands with first end-to-end happy path
- No SEO scripts (sitemap, RSS, OG image generation) — lands with marketing surfaces

Each addition arrives with a PR that updates this list.
