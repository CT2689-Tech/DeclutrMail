/**
 * MarketingNav session-probe tests (D134 §2 routing).
 *
 * The invariant: the masthead paints the logged-out state IMMEDIATELY
 * (first render, before any network resolves), then upgrades to
 * "Open app" only when `GET /api/auth/me` comes back 200. The probe
 * must never gate paint and a failed probe must land on logged-out.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installFetchStub } from '@/test/fetch-stub';
import { MarketingNav } from './marketing-nav';

describe('MarketingNav — non-blocking session probe', () => {
  it('paints the Connect CTA synchronously while the probe is still in flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        // Never resolves — simulates a slow API. Paint must not wait.
        respond: () => new Promise<Response>(() => {}),
      },
    ]);
    render(<MarketingNav />);
    expect(screen.getByText('Connect your Gmail')).toBeInTheDocument();
    expect(screen.queryByText('Open app →')).not.toBeInTheDocument();
  });

  it('flips to "Open app" when the probe returns 200', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () => new Response(JSON.stringify({ data: { id: 'u1' } }), { status: 200 }),
      },
    ]);
    render(<MarketingNav />);
    await waitFor(() => expect(screen.getByText('Open app →')).toBeInTheDocument());
    expect(screen.getByText('Open app →')).toHaveAttribute('href', '/senders');
  });

  it('stays logged-out on 401', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
      },
    ]);
    render(<MarketingNav />);
    // Let the probe settle, then confirm no flip happened.
    await waitFor(() => expect(screen.getByText('Connect your Gmail')).toBeInTheDocument());
    expect(screen.queryByText('Open app →')).not.toBeInTheDocument();
  });

  it('stays logged-out when the probe rejects (network failure)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () => Promise.reject(new Error('network down')),
      },
    ]);
    render(<MarketingNav />);
    await waitFor(() => expect(screen.getByText('Connect your Gmail')).toBeInTheDocument());
    expect(screen.queryByText('Open app →')).not.toBeInTheDocument();
  });
});
