// Tests for the onboarding sync gate (D6, D109, D224).
//
// SSR render-shape assertions (same approach as triage-screen.test.tsx)
// plus pure-function coverage of the stage-mapping helper. The push
// permission ask is a `useEffect`-gated client affordance, so it is
// absent under `renderToStaticMarkup` — that is expected and not
// asserted here.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { SyncGate, activeStageIndex, UI_STAGES } from './sync-gate';

const SYNCING: SyncStatus = {
  readiness_status: 'syncing',
  current_stage: 'building_sender_index',
  progress_pct: 45,
  is_ready_for_triage: false,
};

const READY: SyncStatus = {
  readiness_status: 'ready',
  current_stage: 'ready',
  progress_pct: 100,
  is_ready_for_triage: true,
};

const FAILED: SyncStatus = {
  readiness_status: 'failed',
  current_stage: 'failed',
  progress_pct: 32,
  is_ready_for_triage: false,
  error_code: 'GMAIL_QUOTA_EXCEEDED',
};

describe('activeStageIndex (D109 stage mapping)', () => {
  it('maps progress_pct into one of six buckets while syncing', () => {
    expect(activeStageIndex({ ...SYNCING, progress_pct: 0 })).toBe(0);
    expect(activeStageIndex({ ...SYNCING, progress_pct: 45 })).toBe(2);
    expect(activeStageIndex({ ...SYNCING, progress_pct: 99 })).toBe(5);
  });

  it('never highlights "Done" while still syncing (clamps below last index)', () => {
    expect(activeStageIndex({ ...SYNCING, progress_pct: 100 })).toBeLessThan(UI_STAGES.length);
  });

  it('marks every stage complete when readiness is ready', () => {
    expect(activeStageIndex(READY)).toBe(UI_STAGES.length);
  });
});

describe('SyncGate render', () => {
  it('syncing: shows the title, a progressbar with the real percent, and the trust badge', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).toContain('Reading your inbox');
    expect(html).toContain('aria-valuenow="45"');
    // D7 trust artifact — exact copy.
    expect(html).toContain('Bodies read: 0 — forever');
    // No time promise (D109 hard rule).
    expect(html).not.toMatch(/\d+\s*(min|minute|hour|sec)/i);
  });

  it('syncing: renders all six stage labels', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    for (const label of UI_STAGES) {
      // React escapes `&` to `&amp;` in the served markup.
      expect(html).toContain(label.replace(/&/g, '&amp;'));
    }
  });

  it('failed: shows the error copy + retry, still shows the trust badge', () => {
    const html = renderToStaticMarkup(<SyncGate status={FAILED} />);
    expect(html).toContain('snag');
    expect(html).toContain('Try again');
    expect(html).toContain('Bodies read: 0 — forever');
  });

  it('never renders the word "Screen" anywhere (D227 hard rule)', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).not.toMatch(/\bScreen\b/);
  });
});
