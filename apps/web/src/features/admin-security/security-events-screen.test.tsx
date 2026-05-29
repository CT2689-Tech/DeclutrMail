/**
 * Tests for `AdminSecurityEventsScreen` (D181 read surface).
 *
 * Covers the four first-class states per D211 / D212 (loading, error,
 * empty, populated) + the operator-side specifics: the 404-as-not-found
 * surface for non-allowlisted users, the filter-bar wiring, and the
 * Load-more pagination affordance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { AdminSecurityEventsScreen } from './security-events-screen';

const NOW = '2026-05-29T18:00:00.000Z';

interface WireRow {
  id: string;
  eventType: string;
  severity: 'info' | 'warning' | 'critical';
  occurredAt: string;
  workspaceId: string | null;
  userId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  payload: Record<string, unknown> | null;
}

function row(overrides: Partial<WireRow> = {}): WireRow {
  return {
    id: 'evt-1',
    eventType: 'login.failure',
    severity: 'warning',
    occurredAt: NOW,
    workspaceId: null,
    userId: null,
    sourceIp: '203.0.113.7',
    userAgent: 'curl/8',
    payload: { provider: 'google', reason: 'missing_state_cookie' },
    ...overrides,
  };
}

function envelope(items: WireRow[], nextCursor: string | null = null) {
  return {
    data: items,
    meta: { pagination: { nextCursor, hasMore: nextCursor !== null, limit: 50 } },
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <AdminSecurityEventsScreen />
    </QueryWrapper>,
  );
}

beforeEach(() => {
  installFetchStub();
});

afterEach(() => {
  resetFetchStub();
});

describe('AdminSecurityEventsScreen — render states', () => {
  it('renders the populated table with one row per event', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: () =>
          jsonOk(
            envelope([
              row({ id: 'a', eventType: 'login.failure', severity: 'warning' }),
              row({
                id: 'b',
                eventType: 'rate_limit.breach',
                severity: 'critical',
                payload: { bucket: 'auth' },
              }),
            ]),
          ),
      },
    ]);

    renderScreen();

    await waitFor(() => {
      expect(screen.getByText('login.failure')).toBeInTheDocument();
    });
    expect(screen.getByText('rate_limit.breach')).toBeInTheDocument();
    // Severity pills present
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
  });

  it('renders the empty state when no events match', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/security-events', respond: () => jsonOk(envelope([])) },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/No events match these filters/i)).toBeInTheDocument();
    });
  });

  it('renders the 404-as-not-found surface for non-allowlisted users', async () => {
    // AdminAllowlistGuard returns 404 (never 403/401) so the FE
    // mirrors that posture — no message that confirms the route's
    // existence to a non-admin.
    installFetchStub([
      { method: 'GET', path: '/api/security-events', respond: () => jsonNotFound() },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/This page does not exist or is not available for your account/i),
    ).toBeInTheDocument();
    // Crucially: the 404 surface must NOT confirm the route exists —
    // no "permission denied" / "not authorized" / "admin only" copy
    // that would reveal the surface to a non-admin enumerator.
    expect(document.body.textContent ?? '').not.toMatch(/permission denied/i);
    expect(document.body.textContent ?? '').not.toMatch(/not authorized/i);
    expect(document.body.textContent ?? '').not.toMatch(/admin only/i);
  });

  it('renders an error surface for non-404 failures (server error)', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/security-events', respond: () => jsonServerError() },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load events/i)).toBeInTheDocument();
    });
  });
});

describe('AdminSecurityEventsScreen — filter wiring', () => {
  it('sends the selected severity as a query param', async () => {
    let lastUrl: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: (req, url) => {
          lastUrl = url.search;
          return jsonOk(envelope([]));
        },
      },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(lastUrl).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by severity'), 'critical');

    await waitFor(() => {
      expect(lastUrl).toContain('severity=critical');
    });
  });

  it('sends the typed event_type as a query param', async () => {
    let lastUrl: string | null = null;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: (req, url) => {
          lastUrl = url.search;
          return jsonOk(envelope([]));
        },
      },
    ]);
    renderScreen();
    await waitFor(() => {
      expect(lastUrl).not.toBeNull();
    });

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Filter by event type'), 'webhook.signature_failure');

    await waitFor(() => {
      expect(lastUrl).toContain('event_type=webhook.signature_failure');
    });
  });
});

describe('AdminSecurityEventsScreen — Load more', () => {
  it('shows a Load more button only when the page reports hasMore, and fetches the next page on click', async () => {
    let callCount = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: (req, url) => {
          callCount += 1;
          if (callCount === 1) {
            return jsonOk(envelope([row({ id: 'page-1' })], 'next-cursor-1'));
          }
          // Second call must carry the cursor.
          expect(url.search).toContain('cursor=next-cursor-1');
          return jsonOk(envelope([row({ id: 'page-2' })], null));
        },
      },
    ]);
    renderScreen();

    const loadMore = await screen.findByRole('button', { name: /load more/i });
    expect(loadMore).toBeInTheDocument();
    // First row is visible
    await waitFor(() => {
      expect(screen.getByText('login.failure')).toBeInTheDocument();
    });

    const user = userEvent.setup();
    await user.click(loadMore);

    await waitFor(() => {
      // Two rows now visible
      expect(screen.getAllByText('login.failure')).toHaveLength(2);
    });
    // hasMore=false on the second page → button disappears
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });
  });
});
