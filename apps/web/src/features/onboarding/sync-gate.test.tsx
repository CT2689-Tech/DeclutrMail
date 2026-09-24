// Tests for the onboarding sync gate (D6, D109, D224).
//
// SSR render-shape assertions (same approach as triage-screen.test.tsx)
// plus pure-function coverage of the stage-mapping helper.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import type { SyncStatus } from '@declutrmail/shared/contracts';

import { SyncGate, stageSentence } from './sync-gate';
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

describe('stageSentence (D224 — the REAL current_stage, one sentence)', () => {
  it('names the stage the worker reports, not a bucket of the percentage', () => {
    expect(stageSentence(SYNCING)).toBe('Grouping email by sender.');
    // Same percentage, different real stage ⇒ different sentence.
    expect(stageSentence({ ...SYNCING, current_stage: 'fetching_metadata' })).toBe(
      'Reading sender info.',
    );
    expect(stageSentence({ ...SYNCING, current_stage: 'queued', progress_pct: 0 })).toBe(
      'Waiting to start.',
    );
  });

  // The worker writes `computing_recommendations, 90` then `finalizing, 97`
  // while still `syncing` — minutes on a large mailbox — and the old
  // six-row list lit "Done" for that whole span (audit 2026-08-21).
  it('never says the inbox is ready while still syncing', () => {
    for (const stage of [
      'queued',
      'fetching_metadata',
      'building_sender_index',
      'computing_recommendations',
      'finalizing',
      // A stage/readiness disagreement must not read as done either.
      'ready',
    ] as const) {
      expect(stageSentence({ ...SYNCING, current_stage: stage, progress_pct: 99 })).not.toMatch(
        /ready/i,
      );
    }
  });

  it('says ready only from readiness_status', () => {
    expect(stageSentence(READY)).toBe('Your inbox is ready.');
  });
});

describe('SyncGate render', () => {
  it('syncing: the title, ONE progressbar at the real percent, ONE stage sentence', () => {
    const html = renderToStaticMarkup(<SyncGate status={SYNCING} />);
    expect(html).toContain('Reading your inbox');
    expect(html).toContain('aria-valuenow="45"');
    expect(html.match(/role="progressbar"/g)).toHaveLength(1);
    expect(html).toContain('Grouping email by sender.');
    // Journey orientation is separate from the real worker progress.
    expect(html).toContain('aria-label="Getting started"');
    expect(html).toMatch(/aria-current="step"[^>]*>Scan<\/li>/);
    expect(html).not.toContain('Preparing recommendations');
    // A waiting screen is not a decision point: the trust badge lives on
    // the promise step. Banned counter copy stays absent (CLAUDE.md §2.1).
    expect(html).not.toContain('data-dm-privacy-badge');
    expect(html).not.toContain('Bodies read: 0');
    expect(html).not.toContain('Full bodies fetched: 0');
    // No time promise (D109 hard rule).
    expect(html).not.toMatch(/\d+\s*(min|minute|hour|sec)/i);
  });

  it('a non-finite percentage renders an empty bar, never NaN', () => {
    const html = renderToStaticMarkup(
      <SyncGate status={{ ...SYNCING, progress_pct: Number.NaN }} />,
    );
    expect(html).toContain('aria-valuenow="0"');
    expect(html).not.toContain('NaN');
  });

  it('does not prompt for browser notifications and promises no email it cannot prove', () => {
    const requestPermission = vi.fn().mockResolvedValue('granted');
    vi.stubGlobal('Notification', { permission: 'default', requestPermission });

    render(<SyncGate status={SYNCING} />);

    expect(screen.queryByText(/email you/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /get notified when ready/i })).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('failed: cause + next action, with a real retry', () => {
    const html = renderToStaticMarkup(withClient(<SyncGate status={FAILED} />));
    expect(html).toContain('scan stopped');
    expect(html).toContain('Try again');
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

  it.each(['InvalidGrantError', 'AuthExpiredError'] as const)(
    'clicking "Reconnect Gmail" starts OAuth targeted at the mailbox on screen (%s)',
    (errorCode) => {
      // The negative control for `AuthExpiredError`: this closes a test
      // gap Codex adversarial review found — the prior test only
      // asserted the button's presence for `AuthExpiredError`, never
      // that clicking it actually wires to `startMailboxConnect` rather
      // than falling through to the retry mutation.
      //
      // `mockClear()` first (Codex adversarial review round 2): this
      // file has no global `clearMocks`/`beforeEach`, and the module
      // mock is one shared fn across every test in the file — without
      // this, the `InvalidGrantError` iteration's call could make the
      // `AuthExpiredError` iteration's assertion pass even if THAT
      // click made no call at all.
      vi.mocked(startMailboxConnect).mockClear();
      render(
        withClient(<SyncGate status={{ ...FAILED, error_code: errorCode }} mailboxId="mb-1" />),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Reconnect Gmail' }));
      expect(vi.mocked(startMailboxConnect)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(startMailboxConnect)).toHaveBeenCalledWith('mb-1');
    },
  );

  it('still offers a real retry for a non-auth failure (e.g. RateLimitError)', () => {
    render(withClient(<SyncGate status={FAILED} mailboxId="mb-1" />));
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect Gmail' })).not.toBeInTheDocument();
  });
});

describe('SyncGate escape hatch (D116 — secondary connect)', () => {
  it('renders ONE quiet "Go back to <primary>" when an escape is passed', () => {
    const html = renderToStaticMarkup(
      <SyncGate
        status={SYNCING}
        escape={{ returnToEmail: 'primary@example.com', onReturn() {} }}
      />,
    );
    expect(html).toContain('Go back to primary@example.com');
    expect(html).not.toContain('Stay here');
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

  it('failed-needing-reauth + escape: "Go back" is still reachable beside "Reconnect Gmail" (Codex adversarial review)', () => {
    // Closes a test gap Codex found — the failed+escape case above only
    // used the generic failure fixture; an auth-recovery error code
    // swaps the primary button to "Reconnect Gmail", so this proves the
    // escape hatch wasn't accidentally coupled to that branch choice.
    const onReturn = vi.fn();
    render(
      withClient(
        <SyncGate
          status={{ ...FAILED, error_code: 'AuthExpiredError' }}
          escape={{ returnToEmail: 'primary@example.com', onReturn }}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go back to primary@example\.com/ }));
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
