# `packages/shared/src/state/` — Zustand client-state scaffold

Per **D200**, DeclutrMail splits frontend state into two strictly
separate layers:

| Layer | Library | What lives here |
| --- | --- | --- |
| **Server state** | TanStack Query (`@tanstack/react-query`) | Anything fetched from the API — sender list, activity log, sync status polling, etc. |
| **Client state** | Zustand (`zustand`) | Ephemeral browser-only flags — sidebar collapsed, command palette open, expanded row id, filter draft values |

This directory is the home for **cross-feature client-only stores**
that pass the D199 lazy-promotion bar (≥2 actual consumers, or a
spec-named multi-consumer surface). The current example —
[`ui-store.ts`](./ui-store.ts) — owns transient UI flags that
genuinely span features (e.g., the command palette / kbd-launcher is
opened from any screen).

## Boundary rules (lifted from D200)

- **Server-shaped data does not belong in Zustand.** Caching an API
  response in a Zustand store violates the boundary; use TanStack
  Query and let its cache do that job.
- **Per-feature client state stays inside the feature**, not here.
  `apps/web/src/features/{feature}/store.ts` is the canonical home
  for a feature's local Zustand store (e.g., a triage feature's
  `expandedRowId` or filter-draft values).
- **Tokens or secrets are forbidden in any store.** Auth tokens live
  in HttpOnly cookies per D155 and are never readable from JS.

## When to add a store here

A new store earns its spot in `packages/shared/src/state/` only when
either:

1. ≥2 features in `apps/web/src/features/` import it (D199 lazy
   promotion — the second-consumer PR is when the move happens), or
2. A D-decision names ≥2 spec-future consumers (D199 spec override).

Otherwise the store lives next to the feature that owns it.

## File-header template

```ts
// packages/shared/src/state/<name>.ts
//
// Promoted to packages/shared/ in PR #<n> per D199 (lazy promotion).
// Consumers:
//   - apps/web/src/features/<feature-A>/...
//   - apps/web/src/features/<feature-B>/...
//
// Shape locked at promotion. New fields require an ADR + multi-
// feature PR.
```
