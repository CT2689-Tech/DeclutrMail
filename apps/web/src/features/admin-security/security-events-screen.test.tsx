/**
 * Tests for `AdminSecurityEventsScreen` (D181 read surface).
 *
 * Covers the four first-class states per D211 / D212 (loading, error,
 * empty, populated) + the operator-side specifics: the 404-as-not-found
 * surface for non-allowlisted users, the filter-bar wiring, and the
 * Load-more pagination affordance.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  installFetchStub,
  jsonNotFound,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { securityEventsKeys } from './api/query-keys';
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
  render(
    <QueryWrapper client={client}>
      <AdminSecurityEventsScreen />
    </QueryWrapper>,
  );
  return client;
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

  it('renders the 404-as-not-found surface for non-allowlisted users, with NO ScreenIntro/filters above', async () => {
    // AdminAllowlistGuard returns 404 (never 403/401) so the FE
    // mirrors that posture — no message that confirms the route's
    // existence to a non-admin. Crucially this means the ScreenIntro
    // ("Security events" title) AND the filter bar must NOT render
    // above the not-found surface; their presence would imply real
    // data exists behind the gate.
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
    // The screen title MUST NOT be present — it would hint that the
    // "Security events" page exists behind the gate.
    expect(screen.queryByText('Security events')).not.toBeInTheDocument();
    // The filter region MUST NOT mount — would imply real data exists.
    expect(screen.queryByRole('region', { name: /filters/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filter by severity/i)).not.toBeInTheDocument();
    // No "permission denied" / "not authorized" / "admin only" copy
    // that would reveal the surface to a non-admin enumerator.
    expect(document.body.textContent ?? '').not.toMatch(/permission denied/i);
    expect(document.body.textContent ?? '').not.toMatch(/not authorized/i);
    expect(document.body.textContent ?? '').not.toMatch(/admin only/i);
  });

  it('renders a privacy-safe error surface and recovers when retry succeeds', async () => {
    let attempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: () => {
          attempts += 1;
          return attempts === 1
            ? jsonServerError('database.internal=private')
            : jsonOk(envelope([row({ id: 'recovered', eventType: 'login.success' })]));
        },
      },
    ]);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      screen.getByRole('heading', { name: /couldn't load security events/i }),
    ).toBeInTheDocument();
    expect(alert).not.toHaveTextContent('/api/security-events');
    expect(alert).not.toHaveTextContent('database.internal');

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('login.success')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('keeps loaded rows and pagination visible when a refresh fails, then retries it', async () => {
    let attempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: () => {
          attempts += 1;
          if (attempts === 1) {
            return jsonOk(
              envelope([row({ id: 'cached', eventType: 'login.failure' })], 'next-cursor-1'),
            );
          }
          if (attempts === 2) return jsonServerError('refresh.internal=private');
          return jsonOk(
            envelope([row({ id: 'refreshed', eventType: 'login.success' })], 'next-cursor-1'),
          );
        },
      },
    ]);
    const client = renderScreen();

    expect(await screen.findByText('login.failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();

    await act(async () => {
      await client.refetchQueries({ queryKey: securityEventsKeys.all });
    });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't refresh security events/i);
    expect(alert).not.toHaveTextContent('refresh.internal');
    expect(screen.getByText('login.failure')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry refresh/i }));

    expect(await screen.findByText('login.success')).toBeInTheDocument();
    expect(screen.queryByText('login.failure')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
    expect(attempts).toBe(3);
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

  it('keeps page one visible when loading more fails, then retries the same page', async () => {
    let callCount = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/security-events',
        respond: (req, url) => {
          callCount += 1;
          if (callCount === 1) {
            return jsonOk(
              envelope([row({ id: 'page-1', eventType: 'login.failure' })], 'next-cursor-1'),
            );
          }

          expect(url.search).toContain('cursor=next-cursor-1');
          if (callCount === 2) return jsonServerError('pagination.internal=private');

          return jsonOk(envelope([row({ id: 'page-2', eventType: 'rate_limit.breach' })], null));
        },
      },
    ]);
    renderScreen();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /load more/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't load more events/i);
    expect(alert).not.toHaveTextContent('pagination.internal');
    expect(screen.getByText('login.failure')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('rate_limit.breach')).toBeInTheDocument();
    expect(screen.getByText('login.failure')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(callCount).toBe(3);
  });
});
