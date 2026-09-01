// Tests for the onboarding sync gate (D6, D109, D224).
//
// SSR render-shape assertions (same approach as triage-screen.test.tsx)
// plus pure-function coverage of the stage-mapping helper.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { SyncGate, activeStageIndex, UI_STAGES } from './sync-gate';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';

vi.mock('@/features/mailboxes/connect-mailbox-url', () => ({
  startMailboxConnect: vi.fn(),
}));

/**
 * The failed gate mounts `useRetryInitialSync` (its "Try again" is a
 * real server re-queue now, not a page reload), so any render of a
 * FAILED status needs a QueryClient in scope.
 */
function withClient(node: ReactNode) {
  return <QueryWrapper client={createTestQueryClient()}>{node}</QueryWrapper>;
}

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
  error_code: 'RateLimitError',
};

describe('activeStageIndex (D109 stage mapping)', () => {
  it('maps progress_pct into one of six buckets while syncing', () => {
    expect(activeStageIndex({ ...SYNCING, progress_pct: 0 })).toBe(0);
    expect(activeStageIndex({ ...SYNCING, progress_pct: 45 })).toBe(2);
    // 99% lands on "Preparing recommendations", not "Done".
    expect(activeStageIndex({ ...SYNCING, progress_pct: 99 })).toBe(4);
  });

  // This assertion used to be `toBeLessThan(UI_STAGES.length)` — i.e.
  // `< 6`. Index 5 IS "Done — your inbox is ready", and 5 < 6, so the
  // test passed for the entire time the bug was live: the worker writes
  // 90 then 97 while still `syncing`, and the gate showed "Done" under a
  // heading still reading "Reading your inbox…". A guard has to assert
  // the thing its NAME claims, so this now names the label.
  it('never highlights "Done" while still syncing', () => {
    for (const pct of [90, 97, 99, 100]) {
      const index = activeStageIndex({ ...SYNCING, progress_pct: pct });
      expect(UI_STAGES[index]).not.toBe('Done — your inbox is ready');
      expect(index).toBeLessThan(UI_STAGES.length - 1);
    }
  });

  // Every clamp comparison against NaN is false, so a non-finite
  // percentage would propagate through `Math.min`/`Math.max` unchanged
  // and light up no row at all — a gate that looks frozen.
  it('falls back to the first stage on a non-finite percentage', () => {
    expect(activeStageIndex({ ...SYNCING, progress_pct: Number.NaN })).toBe(0);
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
    expect(html).toContain('We never fetch or store full email contents.');
    expect(html).toContain('Sender name and email address');
    // Pre-D228 wording is BANNED in product UI (CLAUDE.md §2.1).
    expect(html).not.toContain('Bodies read: 0');
    expect(html).not.toContain('Full bodies fetched: 0');
    // No time promise (D109 hard rule).
    expect(html).not.toMatch(/\d+\s*(min|minute|hour|sec)/i);
  });

  it('does not prompt for browser notifications while preserving email-ready copy', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    render(<SyncGate status={SYNCING} />);

    expect(screen.getByText(/we’ll email you when your inbox is ready/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /get notified when ready/i })).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('syncing: renders all six stage labels', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    for (const label of UI_STAGES) {
      // React escapes `&` to `&amp;` in the served markup.
      expect(html).toContain(label.replace(/&/g, '&amp;'));
    }
  });

  it('failed: shows the error copy + retry, still shows the trust badge', () => {
    const html = renderToStaticMarkup(withClient(<SyncGate status={FAILED} />));
    expect(html).toContain('snag');
    expect(html).toContain('Try again');
    // D228 trust artifact present on the failed state too — banned copy absent.
    expect(html).toContain('We never fetch or store full email contents.');
    expect(html).toContain('Sender name and email address');
    expect(html).not.toContain('Bodies read: 0');
    expect(html).not.toContain('Full bodies fetched: 0');
  });

  it('never promises an automatic retry it cannot deliver', () => {
    // The old copy said "We'll retry automatically — check back
    // shortly". After maxAttempts the state is TERMINAL: the
    // reconciler sweeps `queued` rows only, so nothing re-queued a
    // `failed` one and the user waited forever (flow audit
    // 2026-07-28). The screen must point at the button instead.
    const html = renderToStaticMarkup(withClient(<SyncGate status={FAILED} />));
    expect(html).not.toContain('retry automatically');
    expect(html).not.toContain('check back shortly');
    expect(html).toContain('Try again');

    const quota = renderToStaticMarkup(
      withClient(<SyncGate status={{ ...FAILED, error_code: 'RateLimitError' }} />),
    );
    expect(quota).not.toContain('retry automatically');
  });

  /**
   * The map is keyed on `error.name` of the thrown worker error, because
   * that is literally what `initial-sync.worker.ts` writes to
   * `provider_sync_state.error_code` (`errorCode: error.name`).
   *
   * It used to be keyed on `GMAIL_QUOTA_EXCEEDED`, a code NO code path has
   * ever emitted — so every real failure fell through to the generic copy,
   * and every test "passed" because the fixtures invented the same
   * fictional code. Production 2026-08-06 surfaced it: a PermanentError
   * rendered as "Something interrupted the scan". Keep this list in step
   * with `packages/workers/src/worker-errors.ts`.
   */
  it('keys its copy on the error names the worker actually stores', () => {
    const WORKER_ERROR_NAMES = [
      'TransientError',
      'RateLimitError',
      'AuthExpiredError',
      'InvalidGrantError',
      'ValidationError',
      'PermanentError',
    ];

    for (const name of WORKER_ERROR_NAMES) {
      const html = renderToStaticMarkup(
        withClient(<SyncGate status={{ ...FAILED, error_code: name }} />),
      );
      expect(
        html,
        `${name} has no specific copy — it falls back to the generic line`,
      ).not.toContain('Something interrupted the scan');
    }
  });

  it('never renders the word "Screen" anywhere (D227 hard rule)', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).not.toMatch(/\bScreen\b/);
  });
});

describe('SyncGate — auth failures offer reconnect, not a doomed retry (QA-sync-20260831-07)', () => {
  it('offers "Reconnect Gmail" instead of "Try again" for InvalidGrantError', () => {
    // The negative control: reverting the `needsReconnect` branch makes
    // this assertion fail — the only button used to re-queue a full
    // scan against the SAME revoked token, which fails again at
    // `getClient` and burns a rate-limited retry attempt.
    render(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'InvalidGrantError' }} mailboxId="mb-1" />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('offers "Reconnect Gmail" for AuthExpiredError too', () => {
    render(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'AuthExpiredError' }} mailboxId="mb-1" />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('clicking "Reconnect Gmail" starts OAuth targeted at the mailbox on screen', () => {
    render(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'InvalidGrantError' }} mailboxId="mb-1" />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }));
    expect(vi.mocked(startMailboxConnect)).toHaveBeenCalledWith('mb-1');
  });

  it('still offers a real retry for a non-auth failure (e.g. RateLimitError)', () => {
    render(withClient(<SyncGate status={FAILED} mailboxId="mb-1" />));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Gmail' })).not.toBeInTheDocument();
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
      withClient(
        <SyncGate status={FAILED} escape={{ returnToEmail: 'primary@example.com', onReturn }} />,
      ),
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
