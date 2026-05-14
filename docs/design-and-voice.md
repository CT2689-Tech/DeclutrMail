# Design and voice

Design system principles, voice guide, and repository conventions. Loaded by subagents working on UI, copy, or any visible surface.

## Design system principles

### Editorial typography is marketing-only

Marketing routes (Landing, Pricing, Compare, FAQ, Legal, Contact, Blog, Guides) use the Fraunces + Source Serif 4 + JetBrains Mono editorial vocabulary in `src/index.css`. Product app surfaces (Dashboard, Settings, Billing, etc.) use Inter sans + standard Card/Dialog patterns.

On transactional surfaces, "common" reads as "trustworthy"; "editorial" reads as "wrong product." Brand atoms (`<BrandAtom/>`, `<Display/>`, `<Eyebrow/>`, `<PageMast/>`, `<Pill/>`) are marketing-side primitives.

### Three semantic hues plus brand

`--primary` (brand teal), `--success` (emerald), `--warning` (amber), `--destructive`/`--danger` (reds). Stay inside this palette. Purple, orange, indigo, pink are outside the system.

### The italic accent earns its place

Marketing heroes use one italic Fraunces accent per page, applied to the phrase that names what makes the product different. If the italic phrase could appear unchanged on a competitor's page, it isn't earning the accent.

### Single-word eyebrows on top-level marketing routes

`Pricing`, `FAQ`, `Compare`, `Contact`. No articles, no descriptors, no taglines. Em-dashed eyebrows (`— Featured —`) are for in-page section eyebrows below the hero.

### Radius scale is fixed for primitives

`rounded-md` (6 px) and `rounded-sm` (4 px) are pinned in `tailwind.config.ts` (and exposed as `--radius-md` / `--radius-sm` in `src/index.css`). They don't compute from `--radius`. Large cards/panels use `rounded-lg` (1 rem). Small primitives stay crisp — a 20 px checkbox with 12 px corner radius reads as a circle.

### Motion is color, not transform

On card lists, prefer `hover:border-*` / `hover:bg-muted/*` over `hover:scale-*` / `hover:-translate-*`. Cursor-driven transforms across a grid create visual noise.

## Voice

**1Password-reassuring + Notion-warm. Calm operator.**

- Address inbox shame without naming it as shame.
- Use contractions. Be conversational.
- No exclamation points. No emoji in product copy. No urgency timers. No "we miss you" emails.
- Tell users what we do, not how we feel about it.

Examples:

- ✓ "Snoozed Sarah until tomorrow 9 AM. Undo from History anytime."
- ✗ "Don't worry, we've got Sarah's email safely tucked away! 💤"

Restraint is the differentiation. Every UI decision makes the calmness more visible, not less.

## Repository conventions

### Folder structure

Grows organically; this is the shape it grows _into_:

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

### Naming

- Components: `PascalCase.tsx`, `export function ComponentName()`
- Hooks: `use-kebab-case.ts`, `export function useCamelCase()`
- Utility files: `kebab-case.ts`
- Types: `PascalCase`, prefer `type` over `interface` unless declaration merging / extending externals is needed

### Provider stack — strictly additive as features land

Today:

```
BrowserRouter → Routes
```

Each new provider arrives with the first feature that requires it. Never pre-add.
