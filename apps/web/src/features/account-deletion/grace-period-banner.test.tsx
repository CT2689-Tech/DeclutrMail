/**
 * GracePeriodBanner tests (D216 step 3 + D232).
 *
 * Fetch-stubbed — covers: hidden when nothing pending, the scheduled
 * date + cancel flow (banner disappears on success), the undo-window
 * explanation, and the executing state (no cancel past the point of
 * no return).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { AccountDeletionStatus } from '@declutrmail/shared/contracts';
import { installFetchStub, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { GracePeriodBanner } from './grace-period-banner';

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const PROJECTION = {
  flatGraceAt: '2026-06-18T00:00:00.000Z',
  latestUndoExpiresAt: null,
  activeUndoCount: 0,
  projectedEffectiveAt: '2026-06-18T00:00:00.000Z',
  projectedBasis: 'flat-grace' as const,
};

function statusWith(request: AccountDeletionStatus['request']): AccountDeletionStatus {
  return { request, projection: PROJECTION };
}

function renderBanner() {
  const client = createTestQueryClient();
  render(
    <QueryWrapper client={client}>
      <GracePeriodBanner />
    </QueryWrapper>,
  );
}

describe('GracePeriodBanner', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('renders nothing when no deletion is pending', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/account/deletion', respond: () => ok(statusWith(null)) },
    ]);
    renderBanner();
    // Give the query a tick to settle; the banner must stay absent.
    await waitFor(() =>
      expect(screen.queryByTestId('deletion-grace-banner')).not.toBeInTheDocument(),
    );
  });

  it('shows the scheduled date and cancels on click (banner disappears)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () =>
          ok(
            statusWith({
              id: 'req-1',
              requestedAt: '2026-06-11T00:00:00.000Z',
              effectiveAt: '2026-06-18T00:00:00.000Z',
              basis: 'flat-grace',
              waiverConfirmed: false,
              status: 'pending',
            }),
          ),
      },
      {
        method: 'POST',
        path: '/api/account/deletion/cancel',
        respond: () => ok(statusWith(null)),
      },
    ]);
    renderBanner();

    expect(await screen.findByText(/account deletion scheduled for/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel deletion/i }));
    await waitFor(() =>
      expect(screen.queryByTestId('deletion-grace-banner')).not.toBeInTheDocument(),
    );
  });

  it('explains the undo-window extension when that basis won', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () =>
          ok(
            statusWith({
              id: 'req-2',
              requestedAt: '2026-06-11T00:00:00.000Z',
              effectiveAt: '2026-07-06T00:00:00.000Z',
              basis: 'undo-window',
              waiverConfirmed: false,
              status: 'pending',
            }),
          ),
      },
    ]);
    renderBanner();
    expect(await screen.findByText(/undo windows keep working/i)).toBeInTheDocument();
  });

  it('executing state drops the cancel affordance', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/account/deletion',
        respond: () =>
          ok(
            statusWith({
              id: 'req-3',
              requestedAt: '2026-06-11T00:00:00.000Z',
              effectiveAt: '2026-06-11T00:05:00.000Z',
              basis: 'waived-immediate',
              waiverConfirmed: true,
              status: 'executing',
            }),
          ),
      },
    ]);
    renderBanner();
    expect(await screen.findByText(/deletion is in progress/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel deletion/i })).not.toBeInTheDocument();
  });
});
