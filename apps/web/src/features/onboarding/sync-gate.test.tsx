// Tests for the onboarding sync gate (D6, D109, D224).
//
// SSR render-shape assertions (same approach as triage-screen.test.tsx)
// plus pure-function coverage of the stage-mapping helper. The push
// permission ask is a `useEffect`-gated client affordance, so it is
// absent under `renderToStaticMarkup` — that is expected and not
// asserted here.

import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
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
    // D228 trust artifact — locked headline + storage list (shared PrivacyBadge).
    expect(html).toContain('Full bodies fetched: 0');
    expect(html).toContain('Sender (name + email)');
    // Pre-D228 wording is BANNED in product UI (CLAUDE.md §2.1).
    expect(html).not.toContain('Bodies read: 0');
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
    // D228 trust artifact present on the failed state too — banned copy absent.
    expect(html).toContain('Full bodies fetched: 0');
    expect(html).toContain('Sender (name + email)');
    expect(html).not.toContain('Bodies read: 0');
  });

  it('never renders the word "Screen" anywhere (D227 hard rule)', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).not.toMatch(/\bScreen\b/);
  });
});

describe('SyncGate escape hatch (D116 — secondary connect)', () => {
  it('renders "Stay here" + "Go back to <primary>" when an escape is passed', () => {
    const html = renderToStaticMarkup(
      <SyncGate
        status={SYNCING}
        escape={{ returnToEmail: 'primary@example.com', onReturn() {} }}
      />,
    );
    expect(html).toContain('Stay here');
    expect(html).toContain('Go back to primary@example.com');
    expect(html).toContain('keep syncing this inbox in the background');
  });

  it('first-run (no escape): renders no escape hatch — strict gate preserved (D6)', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).not.toContain('Go back to');
    expect(html).not.toContain('Stay here');
  });

  it('"Go back" calls onReturn so the route can switch active + leave', () => {
    const onReturn = vi.fn();
    render(
      <SyncGate status={SYNCING} escape={{ returnToEmail: 'primary@example.com', onReturn }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go back to primary@example\.com/ }));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('failed + escape: offers "Go back" so a secondary connect is not stranded', () => {
    const onReturn = vi.fn();
    render(
      <SyncGate status={FAILED} escape={{ returnToEmail: 'primary@example.com', onReturn }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Go back to primary@example\.com/ }));
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('"Stay here" dismisses the hatch (keeps waiting on the gate)', () => {
    render(
      <SyncGate
        status={SYNCING}
        escape={{ returnToEmail: 'primary@example.com', onReturn: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.queryByText(/Go back to/)).toBeNull();
  });
});
