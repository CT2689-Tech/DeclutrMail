# CLAUDE.md — DeclutrMail

Behavioral guidelines + critical product invariants. Every agent reads this at session start. Heavier reference docs live in `docs/`.

## What this is

DeclutrMail is a Gmail cleanup SaaS. Promise: never reads email bodies, every action is undoable for 7 days, voice is a calm operator. Build philosophy: **one feature at a time, end-to-end** — vertical slice (route + data + tests + design match), shippable on its own.

## Behavioral discipline

These four principles apply to every change. They're generic on purpose — project-specific stuff lives below.

### 1. Think before coding

Don't assume. Don't hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you wrote 200 lines and it could be 50, rewrite it.

Test: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical changes

Touch only what you must. Clean up only your own mess.

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.
- Remove imports/variables/functions that YOUR changes orphaned.

The test: every changed line traces to the request.

### 4. Goal-driven execution

Define success criteria. Loop until verified. Trust command output, not vibes.

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Tests pass before and after."
- After any change, run the gate: `npm run typecheck && npm run lint && npm run test && npm run build`. Quote the actual results — counts, exit codes, bundle delta — not "tests pass."
- Stale results don't count. If you edited after the last run, run again before claiming done.

## Critical invariants — non-negotiable

These four are the rules every PR is checked against. Subagent briefs that violate these are wrong before they start.

1. **Never read email bodies.** Gmail metadata scope only; the same one-line ~160-char preview Gmail shows in list view is the maximum. Settings displays "Bodies read: 0 bytes." The day it isn't is a P0 incident. Full oath: [docs/security-and-privacy.md](docs/security-and-privacy.md).
2. **Editorial typography is marketing-only.** Fraunces / Source Serif 4 / JetBrains Mono editorial vocabulary belongs on Landing / Pricing / Compare / FAQ / Legal / Contact / Blog / Guides. Product surfaces (Dashboard / Settings / Review / Auto-Clean) use Inter sans + standard Card/Dialog patterns.
3. **Three semantic hues + brand.** `--primary` (teal), `--success` (emerald), `--warning` (amber), `--destructive`/`--danger` (reds). No purple, orange, indigo, pink. Pinned `rounded-md` (6 px) and `rounded-sm` (4 px) — they don't compute from `--radius`.
4. **v1 is read-only reference.** A prior implementation lives at `/Users/chintant/projects/declutr-front-zen` (GitHub: `CT2689-Tech/declutr-front-zen`). Read it for behavioral edge-case answers when the design source is silent. Never port v1 patterns "because v1 did it that way." Never carry v1 file names into v2 unless the design source asks for them.

## Hard NEVERs

Universal — don't ship code that does any of these:

- `console.log` in committed code (use `console.warn`/`console.error` with structured context)
- Silent `catch {}` blocks (catch with logging or rethrow)
- `useEffect` for derived state (compute during render or use `useMemo`)
- Setting state in `useEffect` based on props (lift state or `useMemo`)
- Untyped React refs — write `useRef<HTMLDivElement>(null)`, not `useRef(null)`
- Service-role keys touched from the frontend (server-only via edge functions)
- Raw SQL strings concatenated with user input (parameterize)
- `--no-verify` on commits (Husky earns its keep — fix the underlying issue)
- Pushing directly to `main` (auto-deploys; PR-only)

Product:

- Read or log message bodies in any code path
- Mix marketing editorial typography into product UI
- Use purple / orange / indigo / pink in palette decisions
- Add an exclamation point to product copy

## Tech stack — today, in this repo

- React 18 + TypeScript 5.8 (`strict: true`) + Vite 7
- Tailwind 3 + `@tailwindcss/typography` + `tailwindcss-animate`
- React Router 6 (BrowserRouter)
- Vitest 3 + Testing Library + jest-dom + jsdom
- ESLint 9 flat config + jsx-a11y + react-hooks + testing-library + jest-dom (no rules disabled)
- Prettier 3 + Husky 9 + lint-staged

Provider stack (additive as features land — never pre-add):

```
BrowserRouter → Routes
```

Per-feature deps land with the feature: see [docs/feature-checklist.md](docs/feature-checklist.md) for the deferred-dependencies table and what each feature unlocks.

## Commands

```
npm run dev / build / preview / typecheck / lint / format / test / test:watch / test:coverage
```

Path alias: `@/*` → `./src/*`. No others until a real cross-package need exists.

## Design source

Canonical handoff bundle: `/tmp/declutr-design-bd3l/declutrmail-design-system/`. Original URL: `https://api.anthropic.com/v1/design/h/bd3lrmZQXzvk1ikl_Xiifg` (re-fetch if `/tmp` clears). Ignore `_archive/` per its own README.

Per-feature consumption:

- `project/ui_kits/product/v2/screens/<name>.jsx` — canonical screen layout
- `project/ui_kits/product/v2/lib/api-catalog.jsx` — backend contract per screen
- `project/ui_kits/product/v2/lib/primitives.jsx` + `lib/tokens.jsx` — product React primitives (`DVButton`, `DVCard`, `DVPageHeader`, etc.)
- `project/ui_kits/product/v2/marketing/v2-marketing.css` — editorial vocabulary
- `project/colors_and_type.css` — design tokens (ported into `src/index.css`)
- `project/DeclutrMail - Sign in (standalone).html` — Sign-in pixel-match reference

## Where to find more

- [docs/feature-checklist.md](docs/feature-checklist.md) — definition of done, quality bars, verification protocol, deferred dependencies, subagent playbook, what's NOT in the repo yet
- [docs/security-and-privacy.md](docs/security-and-privacy.md) — full privacy oath, security baselines (DB / secrets / OAuth / CSP / logs)
- [docs/design-and-voice.md](docs/design-and-voice.md) — design system principles, voice guide with examples, repository conventions (file layout, naming)
- [.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md) — PR description format, verification checklist, branch + commit conventions

These are reference docs — read them when starting work that touches their domain. Subagent briefs should link to the relevant doc rather than repeating its contents.
