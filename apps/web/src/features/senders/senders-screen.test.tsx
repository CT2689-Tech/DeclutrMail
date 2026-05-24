/**
 * Tests for `SendersScreen` — the list screen wired to the live API.
 *
 * Covers the three first-class branches per D211/D212: loading,
 * error, and a populated list. The empty-mailbox branch (no senders
 * after a fetched-and-empty response) is also asserted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SendersScreen } from './senders-screen';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const ROW = {
  id: 'a',
  displayName: 'Sender A',
  email: 'a@example.com',
  domain: 'example.com',
  gmailCategory: 'promotions' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  monthlyVolume: 30,
  readRate: 0,
  unsubscribeMethod: 'one_click' as const,
};

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SendersScreen />
    </QueryWrapper>,
  );
}

describe('SendersScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('shows a loading skeleton while the initial fetch is in-flight', () => {
    // Handler that never resolves keeps the query in pending state.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);

    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the error branch with a retry CTA on 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => jsonServerError(),
      },
    ]);

    renderScreen();
    // Both the EmptyState heading and the body copy carry this phrase;
    // target the heading so the assertion is unambiguous.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /couldn[’']t load your senders/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('renders the empty-mailbox state when the API returns an empty page', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText(/no senders yet/i)).toBeInTheDocument());
  });

  it('renders the sender count + table when the list resolves', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [ROW, { ...ROW, id: 'b', displayName: 'Sender B' }],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 25 } },
          }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText(/2 senders mail you/i)).toBeInTheDocument());
  });
});
