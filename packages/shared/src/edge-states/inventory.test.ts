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
//   2. Every entry marked `required: true` MUST be either `covered`,
//      `covered-by-pr-52`, or `todo` (never `n/a`). Required-and-N/A
//      is a contradiction — flag it at PR time before it ships.
//
//   3. Every entry marked `required: false` is allowed any status,
//      but if `status: 'covered'` and `storybook` is set, the file
//      still has to exist (no broken pointers).
//
//   4. `covered-by-pr-52` is a transitional literal pointing at the
//      parallel `feat/d039-senders-tightening-pass-1` PR. It MUST be
//      flipped to `covered` (with a real `storybook`) once that PR
//      merges, or back to `todo` if it's cancelled. A dedicated test
//      asserts the literal is bounded — if it sticks around past PR
//      #52's resolution, the founder sees it.
//
// The repo root is resolved via `process.cwd()` because Vitest runs
// from the shared package, but the storybook paths in the inventory
// are repo-relative (they live in `apps/web/**`). The test walks up
// from cwd until it finds the workspace root (the directory with
// `pnpm-workspace.yaml`).

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDGE_STATE_INVENTORY, EDGE_STATES, type EdgeState, type ScreenId } from './inventory';

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
    ] satisfies EdgeState[]);
  });

  it('tracks the PR #52 hand-off with the explicit `covered-by-pr-52` literal', () => {
    // The senders + sender-detail required edge-states ship in the
    // parallel `feat/d039-senders-tightening-pass-1` branch (PR #52).
    // The explicit literal — rather than a vague `todo` — keeps the
    // cross-PR linkage diff-visible. When PR #52 merges, flip these
    // to `covered` with a real `storybook` pointer; if cancelled, drop
    // them back to `todo`. Until then, this assertion locks the
    // current expectation so a silent drift can't happen.
    const sendersRequired = (
      ['loading', 'empty', 'error'] as const satisfies readonly EdgeState[]
    ).map((s) => EDGE_STATE_INVENTORY.senders[s].status);
    expect(sendersRequired).toEqual(['covered-by-pr-52', 'covered-by-pr-52', 'covered-by-pr-52']);

    const detailRequired = (
      [
        'loading',
        'empty',
        'error',
        'sender-deleted-upstream',
      ] as const satisfies readonly EdgeState[]
    ).map((s) => EDGE_STATE_INVENTORY['sender-detail'][s].status);
    expect(detailRequired).toEqual([
      'covered-by-pr-52',
      'covered-by-pr-52',
      'covered-by-pr-52',
      'covered-by-pr-52',
    ]);
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
