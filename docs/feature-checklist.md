# Feature checklist — definition of done, quality bars, verification

A feature ships when ALL apply. Subagents that "feel done" without hitting this list are not done.

## Definition of done

### UI

- [ ] Route exists, reachable, lazy-loaded
- [ ] Pixel-matches the design source
- [ ] Keyboard accessible: axe-clean, focus rings visible, tab order correct
- [ ] Responsive at ≤375 / 768 / ≥1280 px
- [ ] Loading, empty, and error states all implemented (not just happy path)
- [ ] `prefers-reduced-motion` respected for every animation

### Data

- [ ] Edge function deployed, exercisable via curl
- [ ] Migration applied; no table without RLS
- [ ] Query keys centralized; no inline string keys
- [ ] Optimistic UI + rollback for any mutation > 200 ms server round-trip

### Quality

- [ ] TypeScript: 0 errors. No `any` without an `// @explained: …` comment
- [ ] ESLint: 0 errors on touched files. Warnings only with PR explanation
- [ ] Tests: happy path + ≥ 1 edge case + ≥ 1 error case
- [ ] New-file coverage ≥ 70%
- [ ] Bundle delta ≤ +25 KB gzipped (justify if higher)
- [ ] Lighthouse on the affected route ≥ 90 across P/A/BP/SEO

### Production safety

- [ ] Error boundary around the route
- [ ] No loading state locks UI > 5 s without explanation copy
- [ ] Error messages name what failed and what the user can do (no "Something went wrong")
- [ ] Privacy oath upheld (see [security-and-privacy.md](security-and-privacy.md))
- [ ] No `console.log` in committed code; `warn`/`error` only with structured context

### Docs

- [ ] PR description: what, why, verification commands run
- [ ] `.env.local.example` updated if env vars added
- [ ] CLAUDE.md updated if a critical invariant or behavioral rule changed (most changes don't need this)

## Quality bars

These are the numbers. They are the bar, not the aspiration.

### Performance (production)

- LCP < 2.5 s on 4G throttled mid-tier mobile
- INP < 200 ms
- CLS < 0.1
- Edge function p95: < 200 ms for read paths, < 500 ms for write paths that touch Gmail (with fast-ack)
- Cold start budget: < 500 ms

### Bundle

- New feature: ≤ +25 KB gzipped JS
- Landing route post-prerender: ≤ 80 KB gzipped initial JS

### Testing

- New-file coverage ≥ 70%
- Repo-wide thresholds raise as coverage grows; never lower a threshold to make a test green
- Every mutation has an optimistic-rollback test

### Accessibility

- Lighthouse Accessibility ≥ 95
- 0 axe-core violations on authenticated screens
- WCAG 2.1 AA color contrast on primary text + interactive elements
- Focus rings visible and meet 3:1 contrast
- Reduced-motion alternative for every animated state

### SEO (marketing routes)

- Lighthouse SEO ≥ 95
- JSON-LD per route
- Real HTML at first byte (prerender)
- OG image present

## Verification evidence protocol

Every "done" claim ends with the actual command output:

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

## Deferred dependencies — what each feature unlocks

Don't pre-add. Don't pre-config. Each lands with the first feature that needs it:

| Dep                                                | Lands with                                              |
| -------------------------------------------------- | ------------------------------------------------------- |
| `@supabase/supabase-js`                            | First backend-touching feature                          |
| `@tanstack/react-query`                            | First server-state feature                              |
| `react-helmet-async`                               | First marketing route (page-specific meta tags)         |
| `@radix-ui/*` (shadcn primitives)                  | First feature needing accessible interactive primitives |
| `react-hook-form` + `zod`                          | First form                                              |
| `framer-motion`                                    | First motion beyond CSS keyframes                       |
| `@sentry/react`, `@vercel/analytics`, `web-vitals` | First production deploy with monitoring                 |
| `@prerenderer/rollup-plugin` + `puppeteer`         | First marketing route (with prerender)                  |
| Paddle / Razorpay SDKs                             | Billing                                                 |
| `@playwright/test` + `@axe-core/playwright`        | First e2e                                               |
| `@mdx-js/*`                                        | First MDX content (blog / guides)                       |

## What's NOT in this repo yet

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

## Subagent playbook

### When to spawn

- Scope is self-contained — the brief fits in one prompt without external memory
- No mutable state shared with concurrent work
- Verification is mechanical (tests, lint, build, screenshot diff)
- Foreground work would otherwise serialize for ≥ 10 turns

### When not to spawn

- Requires conversation context to interpret correctly
- Needs follow-up questions back to the user
- Shares mutable state with concurrent work (race risk)
- Verification is subjective (visual taste, copy nuance) — keep foreground

### Brief template — every subagent gets these 5 sections

1. **Goal** — one sentence, verifiable outcome
2. **Inputs** — file paths, design source paths, dependencies
3. **Constraints** — what NOT to touch, patterns to match, anti-patterns to avoid
4. **Acceptance** — exact commands the subagent runs to prove done
5. **Reporting** — what to include in the response

Example bad brief: "Build the senders page."
Example good brief: "Implement `src/pages/Senders.tsx` against `/tmp/declutr-design-bd3l/.../screens/senders.jsx`. Use the existing sender-aggregation query from `lib/queries/senders.ts` (don't rewrite). Add 4 tests covering happy / empty / filtered / zero-read pill. Acceptance: `npm run typecheck` → 0 errors, `npm run test` → all new tests pass, `npm run build` → bundle delta < +15 KB gzipped. Report: file paths created, test counts, bundle delta."

### Verifying subagent output — trust nothing

- Re-run the acceptance commands. Subagents sometimes claim pass when they ran a stale build.
- Diff the files they claim changed. "Intended to" leaks into reports.
- Read test bodies. Names sometimes don't match what's asserted.
- For UI: capture preview, compare against the design source.

### Parallelism is earned

- Default to sequential. Each step's output gates the next.
- Parallel only when 2–4 truly independent investigations are needed and the brief inputs don't share state.
- A parallel spawn that creates a merge headache later is a net loss.
