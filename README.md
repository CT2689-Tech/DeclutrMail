# DeclutrMail

**v2 ground-up rebuild.** Gmail cleanup SaaS — never reads email bodies, 7-day undo on every action, calm operator voice.

Built one feature at a time, end-to-end. The v1 implementation at [`CT2689-Tech/declutr-front-zen`](https://github.com/CT2689-Tech/declutr-front-zen) is read-only behavioral reference.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

## Scripts

```bash
npm run dev           # Vite dev server
npm run build         # production build
npm run preview       # preview production build
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format        # Prettier write
npm run test          # Vitest (single run)
npm run test:watch    # Vitest watch
npm run test:coverage # Vitest with v8 coverage
```

## Repository layout

```
src/
├── App.tsx             # Root component
├── main.tsx            # Entry point
├── index.css           # Tailwind directives + v2 design tokens + editorial vocabulary
├── components/
│   └── brand/          # Editorial atoms (BrandAtom, Display, Eyebrow, PageMast, Decision, Pill)
├── lib/
│   └── utils.ts        # cn() helper
└── test/
    └── setup.ts        # Vitest globals (jest-dom, observer mocks, matchMedia mock)
```

Per-feature folders (`src/pages/<route>/`, `src/components/<feature>/`, `supabase/`, etc.) land as features are built.

## Stack

React 18 + TypeScript 5.8 + Vite 7 + Tailwind 3 + Vitest 3 + ESLint 9 (flat config). Dependencies are added per-feature, not speculatively — see [CLAUDE.md](./CLAUDE.md) for the deferred list.

## Design source

The Claude Design handoff bundle (HTML/CSS/JSX prototypes, per-screen API catalog, performance + unified-checkout notes, six audit passes / 33-item punch list closed) is the canonical spec for every screen. See [CLAUDE.md § Design Source](./CLAUDE.md#design-source) for paths and links into the bundle.

## Discipline

See [CLAUDE.md § Working Discipline](./CLAUDE.md#working-discipline) for the rules that apply to every PR: state assumptions explicitly, every changed line traces to the request, convert tasks to verifiable goals, delete legacy when your changes orphan it, no band-aid fixes, no bugs shipped without verification evidence.
