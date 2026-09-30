// Tests for the onboarding sync gate (D6, D109, D224).
//
// SSR render-shape assertions (same approach as triage-screen.test.tsx)
// plus pure-function coverage of the stage-mapping helper.

import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import { STALE_INITIAL_SYNC_MS, type SyncStatus } from '@declutrmail/shared/contracts';

import { SyncGate, stageSentence, timeLeftPhrase } from './sync-gate';
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
  // A first scan: nothing has finished yet.
  last_synced_at: null,
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
    // "Gmail": the scan reads all mail but Spam and Trash, not the inbox.
    expect(html).toContain('Reading your Gmail');
    expect(html).toContain('aria-label="Scan progress"');
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
    // The leave line promises no time, in either variant: time left is
    // only ever an estimate on the count line, from watched progress.
    for (const variant of [html, renderToStaticMarkup(<SyncGate status={SYNCING} readyEmail />)]) {
      expect(variant).not.toMatch(/\d+\s*(min|minute|hour|sec)/i);
    }
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

  it('says the user may leave, and promises the ready email only when it will send (D109)', () => {
    const withEmail = renderToStaticMarkup(<SyncGate status={SYNCING} readyEmail />);
    expect(withEmail).toContain('You can close this tab');
    expect(withEmail).toContain('we’ll email you when your inbox is ready');

    for (const html of [
      renderToStaticMarkup(<SyncGate status={SYNCING} readyEmail={false} />),
      renderToStaticMarkup(<SyncGate status={SYNCING} />),
    ]) {
      expect(html).toContain('You can close this tab');
      expect(html).not.toMatch(/email you/i);
    }
  });

  it('promises no ready email on a re-scan — it goes only for a first scan', () => {
    // A retry after a failed re-scan, or a reconnect, re-runs the scan of
    // a mailbox that finished before; the sync-ready trigger sends
    // nothing for it. A missing field is unknown, and promises nothing.
    const { last_synced_at: _drop, ...unknown } = SYNCING;
    for (const status of [{ ...SYNCING, last_synced_at: '2026-09-01T10:00:00.000Z' }, unknown]) {
      const html = renderToStaticMarkup(<SyncGate status={status} readyEmail />);
      expect(html).toContain('You can close this tab');
      expect(html).not.toMatch(/email you/i);
    }
  });

  it('ready: says so plainly — no "Reading…" title, no leave line, no second ready line', () => {
    const html = renderToStaticMarkup(<SyncGate status={READY} readyEmail />);
    expect(html).toContain('Your inbox is ready.');
    expect(html).not.toContain('Reading your Gmail');
    expect(html).not.toContain('data-testid="sync-leave"');
    expect(html.match(/Your inbox is ready\./g)).toHaveLength(1);
  });

  it('failed: the leave line gives way to cause + next action', () => {
    const html = renderToStaticMarkup(withClient(<SyncGate status={FAILED} readyEmail />));
    expect(html).not.toContain('data-testid="sync-leave"');
    expect(html).not.toMatch(/email you/i);
  });

  it('failed: cause + next action, with a real retry', () => {
    const html = renderToStaticMarkup(withClient(<SyncGate status={FAILED} />));
    // FAILED is RateLimitError + progress 32 → rate_limit partlyReady.
    expect(html).toContain('Your inbox is partly ready');
    expect(html).toContain('Finish sync');
    expect(html).toContain('data-reason-code="rate_limit"');
    expect(html).toContain('data-partly-ready="true"');
    // The trust badge is not on this gate (moved to the promise step) —
    // banned counter copy stays absent regardless.
    expect(html).not.toContain('Bodies read: 0');
    expect(html).not.toContain('Full bodies fetched: 0');
  });

  it('failed: a "reach us" step carries the address — the first-run gate has no route to Help', () => {
    for (const error_code of ['PermanentError', 'ValidationError']) {
      const html = renderToStaticMarkup(
        withClient(<SyncGate status={{ ...FAILED, error_code }} />),
      );
      expect(html, error_code).toContain('support@declutrmail.com');
      expect(html, error_code).not.toMatch(/contact support/i);
    }
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
    expect(html).toContain('Finish sync');

    const quota = renderToStaticMarkup(
      withClient(<SyncGate status={{ ...FAILED, error_code: 'RateLimitError' }} />),
    );
    expect(quota).not.toContain('retry automatically');
  });

  /**
   * Copy is keyed on the Onboarding reason code derived from the worker
   * `error.name` stored on `provider_sync_state.error_code`. Transient /
   * Permanent / Validation share the `unknown` body on purpose — they
   * are Retry, not Reconnect, and Onboarding did not give them distinct
   * sentences. Quota / grant / scopes / expired-auth must not fall
   * through to that unknown tone.
   */
  it('keys reconnect and quota copy on worker names via reason codes', () => {
    const html = (code: string, progress = 32) =>
      renderToStaticMarkup(
        withClient(<SyncGate status={{ ...FAILED, error_code: code, progress_pct: progress }} />),
      );

    expect(html('ProviderPermissionError')).toContain('fuller permission grant');
    expect(html('InvalidGrantError')).toContain('expired or was revoked');
    expect(html('AuthExpiredError')).toContain('stopped accepting our access');
    expect(html('RateLimitError', 0)).toContain('paused your sync');
    expect(html('GmailQuotaError', 32)).toContain('partly ready');

    for (const name of ['TransientError', 'PermanentError', 'ValidationError'] as const) {
      const markup = html(name);
      expect(markup).toContain('We hit a snag reading your inbox');
      expect(markup).toContain('data-reason-code="unknown"');
    }
  });

  it('never renders the word "Screen" anywhere (D227 hard rule)', () => {
    for (const html of [
      renderToStaticMarkup(<SyncGate status={SYNCING} />),
      renderToStaticMarkup(<SyncGate status={SYNCING} readyEmail />),
      renderToStaticMarkup(<SyncGate status={READY} readyEmail />),
    ]) {
      expect(html).not.toMatch(/\bScreen\b/);
    }
  });
});

describe('SyncGate — the scan line "12,400 of 40,898 emails" (D109 reversal 2026-09-26)', () => {
  const READING: SyncStatus = {
    readiness_status: 'syncing',
    current_stage: 'fetching_metadata',
    progress_pct: 26,
    is_ready_for_triage: false,
    last_synced_at: null,
    message_progress: { processed: 12_400, total: 40_898, age_ms: 0 },
  };
  const reading = (processed: number): SyncStatus => ({
    ...READING,
    message_progress: { processed, total: 40_898, age_ms: 0 },
  });

  it('shows emails read of emails in the mailbox, in place of the stage sentence', () => {
    render(<SyncGate status={READING} />);

    const line = screen.getByTestId('sync-count');
    expect(line).toHaveTextContent('12,400 of 40,898 emails');
    // Nothing watched arriving yet, so no time — but its place is kept,
    // so a phone's card does not jump when one arrives.
    expect(line).not.toHaveTextContent(/left/);
    expect(line.querySelector('.dm-scan-time')).toBeEmptyDOMElement();
    // The stage sentence stays the live status — for screen readers only,
    // so each new count is not announced.
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Reading sender info.');
    expect(status).toHaveStyle({ position: 'absolute' });
    expect(line).not.toHaveAttribute('role');
  });

  it('before the mailbox is listed: no count, the stage sentence on screen', () => {
    render(<SyncGate status={{ ...READING, message_progress: null }} />);

    expect(screen.queryByTestId('sync-count')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reading sender info.');
    expect(screen.getByRole('status')).not.toHaveStyle({ position: 'absolute' });
  });

  it('an API without the field (an older deploy) shows no count', () => {
    const { message_progress: _drop, ...older } = READING;

    render(<SyncGate status={older} />);

    expect(screen.queryByTestId('sync-count')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Reading sender info.');
  });

  it('shows counts only while the scan reads the mailbox', () => {
    for (const html of [
      renderToStaticMarkup(
        <SyncGate status={{ ...READING, current_stage: 'building_sender_index' }} />,
      ),
      renderToStaticMarkup(
        <SyncGate
          status={{
            ...READING,
            readiness_status: 'ready',
            current_stage: 'ready',
            is_ready_for_triage: true,
          }}
        />,
      ),
      renderToStaticMarkup(
        withClient(
          <SyncGate
            status={{
              ...READING,
              readiness_status: 'failed',
              current_stage: 'failed',
              error_code: 'TransientError',
            }}
          />,
        ),
      ),
    ]) {
      expect(html).not.toContain('data-testid="sync-count"');
      expect(html).not.toContain('40,898');
    }
  });

  it('adds time left once two gaps are seen after the first poll', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { rerender } = render(<SyncGate status={reading(12_400)} />);
      vi.setSystemTime(10_000);
      rerender(<SyncGate status={reading(12_900)} />);
      vi.setSystemTime(20_000);
      rerender(<SyncGate status={reading(13_400)} />);
      expect(screen.getByTestId('sync-count')).not.toHaveTextContent(/left/);

      vi.setSystemTime(30_000);
      rerender(<SyncGate status={reading(13_900)} />);
      // 26,998 left at 500 per 10s ≈ 9.0 min, rounded up.
      const line = screen.getByTestId('sync-count');
      expect(line).toHaveTextContent('13,900');
      expect(line).toHaveTextContent('about 9 min left');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what the listing found before the first batch lands, not a zero', () => {
    render(<SyncGate status={reading(0)} />);

    expect(screen.getByTestId('sync-count')).toHaveTextContent(/^Found 40,898 emails$/);
  });

  it('counts one email as "email"', () => {
    render(
      <SyncGate status={{ ...READING, message_progress: { processed: 0, total: 1, age_ms: 0 } }} />,
    );

    expect(screen.getByTestId('sync-count')).toHaveTextContent(/^Found 1 email$/);
  });

  it('never splits the total or the time across lines, and gives a phone the time on its own line', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const { container, rerender } = render(<SyncGate status={reading(12_400)} />);
      for (const [at, processed] of [
        [10_000, 12_900],
        [20_000, 13_400],
        [30_000, 13_900],
      ] as const) {
        vi.setSystemTime(at);
        rerender(<SyncGate status={reading(processed)} />);
      }

      const line = screen.getByTestId('sync-count');
      // No break inside "40,898 emails" or before the dot…
      expect(line.textContent).toContain('40,898\u00a0emails\u00a0·');
      // …and the time is one unbreakable phrase.
      const time = line.querySelector('.dm-scan-time');
      expect(time).toHaveTextContent(/^about 9 min left$/);
      expect(time).toHaveStyle({ whiteSpace: 'nowrap' });
      // Below 540px the dot goes and the time takes its own line (a
      // phone cannot hold both on one). The dot is its own element so
      // that rule can drop it.
      expect(line.querySelector('.dm-scan-sep')).toHaveTextContent('·');
      const css = container.querySelector('style')?.textContent ?? '';
      expect(css).toMatch(/@media \(max-width: 539px\)/);
      expect(css).toMatch(/\.dm-scan-sep \{ display: none; \}/);
      expect(css).toMatch(/\.dm-scan-time \{ display: block; min-height: 1\.45em; \}/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('timeLeftPhrase', () => {
  it.each([
    [10_000, 'about 1 min left'],
    [549_960, 'about 10 min left'],
    [59 * 60_000, 'about 59 min left'],
    [60 * 60_000, 'about 1 hr left'],
    [61 * 60_000, 'about 1 hr 5 min left'],
    [119 * 60_000, 'about 2 hr left'],
    [150 * 60_000 + 1, 'about 2 hr 35 min left'],
  ])('%i ms → %s (minutes up; past an hour, up to 5)', (ms, phrase) => {
    expect(timeLeftPhrase(ms)).toBe(phrase);
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

  // D108: a reconnect that comes back without Gmail lands here again, so
  // the line cannot promise that reconnecting restores access.
  it('tells an expired grant what reconnecting needs, without promising it', () => {
    const html = renderToStaticMarkup(
      withClient(<SyncGate status={{ ...FAILED, error_code: 'AuthExpiredError' }} />),
    );
    expect(html).toContain('Reconnect Gmail and allow access');
    expect(html).not.toContain('restores it');
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
    expect(screen.getByRole('heading', { name: 'Your inbox is partly ready' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish sync' })).toBeInTheDocument();
    expect(screen.getByText(/already pulled a lot of your mail/i)).toHaveAttribute(
      'data-reason-code',
      'rate_limit',
    );
    expect(screen.getByText(/already pulled a lot of your mail/i)).toHaveAttribute(
      'data-partly-ready',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Reconnect Gmail' })).not.toBeInTheDocument();
    // Continue is a hook — omitted callback means no silent no-op.
    expect(screen.queryByRole('button', { name: 'Continue ready' })).not.toBeInTheDocument();
  });

  it('offers Reconnect Gmail for ProviderPermissionError (insufficient_scopes, never Retry)', () => {
    render(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'ProviderPermissionError' }} mailboxId="mb-1" />,
      ),
    );
    expect(
      screen.getByRole('heading', { name: 'Gmail needs a fuller permission grant' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument();
    expect(screen.getByText(/get all the permissions/i)).toHaveAttribute(
      'data-reason-code',
      'insufficient_scopes',
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish sync' })).not.toBeInTheDocument();
  });

  it('stamps invalid_grant / reconnect_required on the matching reconnect codes', () => {
    const { rerender } = render(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'InvalidGrantError' }} mailboxId="mb-1" />,
      ),
    );
    expect(
      screen.getByRole('heading', { name: 'Reconnect Gmail to keep going' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/expired or was revoked/i)).toHaveAttribute(
      'data-reason-code',
      'invalid_grant',
    );
    rerender(
      withClient(
        <SyncGate status={{ ...FAILED, error_code: 'AuthExpiredError' }} mailboxId="mb-1" />,
      ),
    );
    expect(
      screen.getByRole('heading', { name: 'Reconnect Gmail to keep going' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/stopped accepting our access/i)).toHaveAttribute(
      'data-reason-code',
      'reconnect_required',
    );
  });

  it('offers Try again for GmailQuotaError with no progress (quota-resume, not reconnect)', () => {
    render(
      withClient(
        <SyncGate
          status={{ ...FAILED, error_code: 'GmailQuotaError', progress_pct: 0 }}
          mailboxId="mb-1"
        />,
      ),
    );
    expect(
      screen.getByRole('heading', { name: 'Gmail paused your sync for a bit' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText(/temporarily limited how fast we can read/i)).toHaveAttribute(
      'data-reason-code',
      'rate_limit',
    );
    expect(screen.getByText(/temporarily limited how fast we can read/i)).toHaveAttribute(
      'data-partly-ready',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Reconnect Gmail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue ready' })).not.toBeInTheDocument();
  });

  it('rate_limit + progress + onContinuePartial: Finish sync | Continue ready', () => {
    const onContinuePartial = vi.fn();
    render(
      withClient(
        <SyncGate
          status={{ ...FAILED, error_code: 'GmailQuotaError', progress_pct: 32 }}
          mailboxId="mb-1"
          onContinuePartial={onContinuePartial}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Finish sync' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your inbox is partly ready' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue ready' }));
    expect(onContinuePartial).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Reconnect Gmail' })).not.toBeInTheDocument();
  });
});

describe('SyncGate — stuck queued/syncing (stale heartbeat)', () => {
  const NOW = Date.parse('2026-09-21T12:00:00.000Z');
  const STUCK_SYNCING: SyncStatus = {
    readiness_status: 'syncing',
    current_stage: 'fetching_metadata',
    progress_pct: 12,
    is_ready_for_triage: false,
    updated_at: new Date(NOW - STALE_INITIAL_SYNC_MS - 1_000).toISOString(),
  };

  it('surfaces a stalled first-run with Try again, not a frozen progress bar', () => {
    // The negative control: ignoring `updated_at` leaves this assertion
    // on "Reading your inbox…" — the silent dead first-run.
    render(withClient(<SyncGate status={STUCK_SYNCING} mailboxId="mb-1" nowMs={NOW} />));
    expect(screen.getByText('This scan has not moved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText(/Gmail is untouched/)).toHaveAttribute('data-reason-code', 'stuck');
    expect(screen.queryByText(/Reading your inbox/)).not.toBeInTheDocument();
    expect(screen.getByText(/Gmail is untouched/)).toBeInTheDocument();
  });

  it('keeps the progress bar while the heartbeat is still fresh', () => {
    render(
      withClient(
        <SyncGate
          status={{
            ...STUCK_SYNCING,
            updated_at: new Date(NOW - 60_000).toISOString(),
          }}
          mailboxId="mb-1"
          nowMs={NOW}
        />,
      ),
    );
    expect(screen.getByText(/Reading your Gmail/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('does not invent stuck when updated_at is omitted', () => {
    const html = renderToStaticMarkup(
      withClient(<SyncGate status={SYNCING} mailboxId="mb-1" nowMs={NOW} />),
    );
    expect(html).toContain('Reading your Gmail');
    expect(html).not.toContain('has not moved');
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
