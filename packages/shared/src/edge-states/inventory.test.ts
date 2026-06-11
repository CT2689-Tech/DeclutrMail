// Contract test for the D211 edge-state inventory.
//
// The inventory at `inventory.ts` declares, per screen, which edge
// states must render at launch. This test enforces the declaration:
//
//   1. Every entry marked `status: 'covered'` MUST point at an existing
//      Storybook file on disk. If the file is missing, this test fails
//      — D211's design-system gate would otherwise rubber-stamp a
//      screen claiming coverage it doesn't have.
//
//   2. Every entry marked `status: 'implemented'` MUST point at an
//      existing app-code file via `implementation`. Same rationale:
//      "implemented" is a coverage claim, so the pointer must resolve.
//
//   3. Every entry marked `required: true` MUST be either `covered`,
//      `implemented`, or `todo` (never `n/a`). Required-and-N/A is a
//      contradiction — flag it at PR time before it ships.
//
//   4. ROUTE PARITY: every `page.tsx` route dir under
//      `apps/web/src/app/(app)` MUST have an inventory row (via
//      `SCREEN_ROUTES`), and every non-null `SCREEN_ROUTES` entry MUST
//      have a route dir on disk. Adding a route without declaring its
//      edge states — the exact gap class this inventory existed to
//      close and then silently fell behind on (6 screens declared vs
//      14 routes shipped, 2026-06-11 refresh) — now fails CI.
//
// The repo root is resolved via `process.cwd()` because Vitest runs
// from the shared package, but the storybook paths in the inventory
// are repo-relative (they live in `apps/web/**`). The test walks up
// from cwd until it finds the workspace root (the directory with
// `pnpm-workspace.yaml`).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EDGE_STATE_INVENTORY,
  EDGE_STATES,
  SCREEN_ROUTES,
  type EdgeState,
  type ScreenId,
} from './inventory';

function findWorkspaceRoot(start: string): string {
  let dir = start;
  // Walk up until we hit a directory containing `pnpm-workspace.yaml`.
  // The shared package lives at `packages/shared`, so at most two
  // hops are needed under normal test invocation; cap at 8 to avoid
  // an unbounded loop if the filesystem layout ever changes.
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'pnpm-workspace.yaml');
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find pnpm-workspace.yaml above ${start}`);
}

const REPO_ROOT = findWorkspaceRoot(process.cwd());

/** The (app) route group whose route dirs the inventory must mirror. */
const APP_ROUTE_GROUP = resolve(REPO_ROOT, 'apps/web/src/app/(app)');

/**
 * Enumerate every route dir (relative, posix-style) under the (app)
 * group that contains a `page.tsx`. `(app)` itself has no page — only
 * `layout.tsx` — so the result is exactly the navigable routes.
 */
function collectRouteDirs(): string[] {
  return readdirSync(APP_ROUTE_GROUP, { recursive: true })
    .map((entry) => String(entry).split(sep).join('/'))
    .filter((entry) => entry === 'page.tsx' || entry.endsWith('/page.tsx'))
    .map((entry) => (entry === 'page.tsx' ? '' : entry.slice(0, -'/page.tsx'.length)))
    .sort();
}

const screens = Object.keys(EDGE_STATE_INVENTORY) as ScreenId[];

describe('D211 — edge-state inventory contract', () => {
  it('enumerates every screen with every known edge state', () => {
    // Defence against a typed gap — if a new state is added to
    // EDGE_STATES but a screen entry is missing it, TypeScript would
    // already complain, but assert at runtime too so the test surfaces
    // the error message clearly.
    for (const screen of screens) {
      const coverage = EDGE_STATE_INVENTORY[screen];
      for (const state of EDGE_STATES) {
        expect(
          coverage[state],
          `screen "${screen}" is missing declaration for edge state "${state}"`,
        ).toBeDefined();
      }
    }
  });

  it('forbids required-and-N/A — a required state cannot be N/A', () => {
    for (const screen of screens) {
      for (const state of EDGE_STATES) {
        const entry = EDGE_STATE_INVENTORY[screen][state];
        if (entry.required && entry.status === 'n/a') {
          throw new Error(`Inventory contradiction: ${screen}.${state} is required but marked n/a`);
        }
      }
    }
  });

  it('points every "covered" entry at a real Storybook file on disk', () => {
    const missing: string[] = [];
    for (const screen of screens) {
      for (const state of EDGE_STATES) {
        const entry = EDGE_STATE_INVENTORY[screen][state];
        if (entry.status !== 'covered') continue;
        if (!entry.storybook) {
          missing.push(`${screen}.${state}: status=covered but no storybook path`);
          continue;
        }
        const absolutePath = resolve(REPO_ROOT, entry.storybook);
        if (!existsSync(absolutePath)) {
          missing.push(`${screen}.${state}: storybook file missing → ${entry.storybook}`);
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('points every "implemented" entry at a real app-code file on disk', () => {
    // `implemented` records a state branch that ships in app code
    // without a dedicated Storybook variant (D211 refresh). The claim
    // still has to resolve to a real file — otherwise it is the same
    // rubber-stamp risk as a broken `covered` pointer.
    const missing: string[] = [];
    for (const screen of screens) {
      for (const state of EDGE_STATES) {
        const entry = EDGE_STATE_INVENTORY[screen][state];
        if (entry.status !== 'implemented') continue;
        if (!entry.implementation) {
          missing.push(`${screen}.${state}: status=implemented but no implementation path`);
          continue;
        }
        const absolutePath = resolve(REPO_ROOT, entry.implementation);
        if (!existsSync(absolutePath)) {
          missing.push(`${screen}.${state}: implementation file missing → ${entry.implementation}`);
        }
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('exports the canonical edge-state set in a stable order', () => {
    // Locking the order keeps test snapshots and design-system gate
    // diffs predictable. If you intentionally add a state, append it.
    expect([...EDGE_STATES]).toEqual([
      'loading',
      'empty',
      'error',
      'partial-error',
      'offline',
      'unauthorized',
      'sync-in-progress',
      'sync-failed-transient',
      'quota-exceeded',
      'free-cap-reached',
      'sender-deleted-upstream',
      'account-deletion-pending',
      'placeholder',
    ] satisfies EdgeState[]);
  });

  it('keeps the inventory in lockstep with the (app) route dirs on disk', () => {
    // THE refresh-leg guard: the original inventory froze at 6 screens
    // while the app grew to 14 routes. This test fails the moment a
    // route ships without an inventory row (add the ScreenId, an
    // EDGE_STATE_INVENTORY row, and a SCREEN_ROUTES entry), or an
    // inventory row outlives its deleted route (remove all three).
    const onDisk = collectRouteDirs();
    const declared = (Object.values(SCREEN_ROUTES).filter((r) => r !== null) as string[]).sort();
    expect(declared, 'SCREEN_ROUTES must exactly mirror (app)/**/page.tsx route dirs').toEqual(
      onDisk,
    );
  });

  it('declares a route (or an explicit null) for every screen', () => {
    // TypeScript enforces Record completeness; assert at runtime too
    // so a build-config drift (e.g. transpile-only) still surfaces.
    for (const screen of screens) {
      expect(
        SCREEN_ROUTES[screen],
        `screen "${screen}" has no SCREEN_ROUTES entry`,
      ).not.toBeUndefined();
    }
  });

  it('records every placeholder route as placeholder-covered and nothing else', () => {
    // The 5 RoutePlaceholder stubs (billing / quiet / screener /
    // settings-index / snoozed) are static server renders — their one
    // designed state is the placeholder itself. Recording any other
    // state as built would be aspiration, not reality.
    const placeholderScreens: ScreenId[] = [
      'billing',
      'quiet',
      'screener',
      'settings-index',
      'snoozed',
    ];
    for (const screen of placeholderScreens) {
      const coverage = EDGE_STATE_INVENTORY[screen];
      expect(coverage.placeholder.required, `${screen}.placeholder should be required`).toBe(true);
      expect(coverage.placeholder.status, `${screen}.placeholder should be covered`).toBe(
        'covered',
      );
      for (const state of EDGE_STATES) {
        if (state === 'placeholder') continue;
        expect(
          coverage[state].status,
          `${screen}.${state} must be n/a while the route is a RoutePlaceholder stub`,
        ).toBe('n/a');
      }
    }
  });

  it('covers the App Router error surfaces (D167)', () => {
    // The 404, 500, and global-error screens are the load-bearing
    // edge-state coverage for *every* unhandled crash path. Lock them
    // here so a future refactor can't accidentally drop the boundary.
    expect(EDGE_STATE_INVENTORY['app-not-found'].empty.status).toBe('covered');
    expect(EDGE_STATE_INVENTORY['app-error-boundary'].error.status).toBe('covered');
    expect(EDGE_STATE_INVENTORY['app-global-error'].error.status).toBe('covered');
  });
});
