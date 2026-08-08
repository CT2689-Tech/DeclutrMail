// Tests for SendersPoliciesScreen — Phase X3 standing-policies view.
//
// Pre-Slice-0 (PR #83) this screen auto-paginated the entire mailbox
// client-side and filtered `s.protected === true` in JS. At 5k+ senders
// it stormed the server and made on-screen counts visibly animate as
// pages landed. Slice 0 of the senders redesign (ADR-0014 + senders list
// contract) pushes the filter server-side via `?protected=true` and
// removes the auto-fetch effect entirely. These tests pin the new
// behavior so a regression (e.g. re-introducing an auto-paginate
// useEffect) fails the build instead of silently restoring the storm.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SendersPoliciesScreen } from './senders-policies-screen';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

const PROTECTION_FLAGS_ON = {
  isProtected: true,
  protectionReason: 'user_defined' as const,
  protectionSetAt: '2026-04-01T00:00:00.000Z',
};

const BASE_ROW = {
  id: 'a',
  displayName: 'Sender A',
  email: 'a@example.com',
  domain: 'example.com',
  gmailCategory: 'updates' as const,
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  monthlyVolume: 10,
  readRate: 0.5,
  volumeTrend: 'steady' as const,
  unsubscribeMethod: null,
  lastReview: null,
  protectionFlags: PROTECTION_FLAGS_ON,
};

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <SendersPoliciesScreen />
    </QueryWrapper>,
  );
}

describe('SendersPoliciesScreen', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('shows the loading skeleton while the senders query is in-flight', () => {
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

  it('renders the empty state when the server returns no protected senders', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText(/No protected senders yet/i)).toBeInTheDocument());
    // Level 1 specifically — the empty state's "No protected senders yet"
    // heading also matches on name alone.
    expect(
      screen.getByRole('heading', { level: 1, name: /protected senders/i }),
    ).toBeInTheDocument();
  });

  it('routes out of the empty state instead of dead-ending', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: 0, globalMaxTotal: 0, asOf: '2026-07-17T00:00:00.000Z' },
            },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText(/No protected senders yet/i)).toBeInTheDocument());
    // Protecting a sender happens on /senders — the empty state must
    // offer the way there, not just describe it.
    expect(screen.getByRole('link', { name: /browse senders/i })).toHaveAttribute(
      'href',
      '/senders',
    );
  });

  it('counts protected senders from the server total, not the loaded page', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            meta: {
              // One row loaded of 137 matching — the header must report the
              // BE-honest query-wide total, never the cursor-scoped page.
              pagination: { nextCursor: 'page-2', hasMore: true, limit: 50 },
              query: { totalMatching: 137, globalMaxTotal: 900, asOf: '2026-07-17T00:00:00.000Z' },
            },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(screen.getByText('137 senders')).toBeInTheDocument();
    expect(screen.queryByText('1 sender')).not.toBeInTheDocument();
  });

  it('singularizes the server total', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: 1, globalMaxTotal: 900, asOf: '2026-07-17T00:00:00.000Z' },
            },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('1 sender')).toBeInTheDocument());
  });

  it('does not present a capped page as a total when the server sends no total', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            // No meta.query — with more pages outstanding, "1 sender" would
            // be a page-cap artifact dressed up as a total.
            meta: { pagination: { nextCursor: 'page-2', hasMore: true, limit: 50 } },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(screen.getByText('Showing 1')).toBeInTheDocument();
    expect(screen.queryByText('1 sender')).not.toBeInTheDocument();
  });

  it('reports the loaded count as the total once the last page has landed', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () =>
          jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            // No meta.query, but hasMore=false — everything matching is on
            // screen, so the loaded count IS the total.
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(screen.getByText('1 sender')).toBeInTheDocument());
  });

  it('fires exactly one server-filtered request for protected senders', async () => {
    const seenUrls: URL[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          seenUrls.push(url);
          return jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());

    // The old behavior auto-paginated until hasMore=false. Slice 0 must
    // make exactly ONE request — anything more is a
    // regression of the storm (and would not survive a 5k mailbox).
    expect(seenUrls).toHaveLength(1);
    const protectedReq = seenUrls.find((u) => u.searchParams.get('protected') === 'true');
    expect(protectedReq).toBeDefined();
    expect(protectedReq!.searchParams.get('limit')).toBe('50');
  });

  it('lists each server-returned protected sender with a Manage link', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: () => {
          return jsonOk({
            data: [
              { ...BASE_ROW, id: 'a', displayName: 'Stripe', email: 'stripe@stripe.com' },
              { ...BASE_ROW, id: 'b', displayName: 'GitHub', email: 'noreply@github.com' },
            ],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('GitHub')).toBeInTheDocument());
    expect(screen.getByText('Stripe')).toBeInTheDocument();
    // The Manage link points at the sender detail page.
    const link = screen.getByRole('link', { name: /manage stripe/i });
    expect(link).toHaveAttribute('href', '/senders/a');
  });

  it('exposes "Show more" when the server reports hasNextPage, and loads the next page on click', async () => {
    let page = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          page += 1;
          const cursor = url.searchParams.get('cursor');
          if (cursor === 'page-2') {
            return jsonOk({
              data: [{ ...BASE_ROW, id: 'p2', displayName: 'Page 2 Sender' }],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
            });
          }
          return jsonOk({
            data: [{ ...BASE_ROW, id: 'p1', displayName: 'Page 1 Sender' }],
            meta: { pagination: { nextCursor: 'page-2', hasMore: true, limit: 50 } },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Page 1 Sender')).toBeInTheDocument());

    // After page 1 lands, exactly one request fired — NO auto-pagination.
    expect(page).toBe(1);
    // The Show more affordance is visible because the server reported hasNextPage.
    // Named 'Show more protected senders' — the button's \`ariaLabel\` was
    // previously spelled \`aria-label\`, which \`Button\` ignores, so the
    // accessible name silently fell back to the visible text.
    const showMore = screen.getByRole('button', { name: /show more protected senders/i });

    await userEvent.click(showMore);

    await waitFor(() => expect(screen.getByText('Page 2 Sender')).toBeInTheDocument());
    expect(page).toBe(2);
    // hasNextPage is now false → Show more disappears.
    expect(screen.queryByRole('button', { name: /^show more$/i })).not.toBeInTheDocument();
  });

  it('renders an alert on a cold 500 and recovers policies when Retry succeeds', async () => {
    let protectedAttempts = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          if (url.searchParams.get('vip') === 'true') {
            return jsonOk({
              data: [],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
            });
          }
          protectedAttempts += 1;
          return protectedAttempts === 1
            ? jsonServerError()
            : jsonOk({
                data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
                meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
              });
        },
      },
    ]);
    renderScreen();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByRole('heading', { name: /couldn[’']t load protected senders/i }),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/existing policies remain active/i)).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(protectedAttempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('SendersPoliciesScreen — the standing protection review (D245)', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  /** One protected page of rows, using the real handler contract. */
  function stubProtectedPage(rows: Array<Record<string, unknown>>) {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) =>
          jsonOk({
            data: url.searchParams.get('protected') === 'true' ? rows : [],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: rows.length },
            },
          }),
      },
    ]);
  }

  it('says WHY each sender is protected', async () => {
    // The 2026-08-07 finding: this list rendered avatar, name and a
    // Manage button and never said why — while three of the four
    // reasons are automatic, so every row looked like the user's own
    // choice. CLAUDE.md §2.6 requires the exact reason.
    stubProtectedPage([
      {
        ...BASE_ROW,
        id: 'a',
        displayName: 'Colleague',
        protectionFlags: { ...PROTECTION_FLAGS_ON, protectionReason: 'replied' },
      },
      {
        ...BASE_ROW,
        id: 'b',
        displayName: 'God of Prompt',
        protectionFlags: { ...PROTECTION_FLAGS_ON, protectionReason: 'starred' },
      },
      {
        ...BASE_ROW,
        id: 'c',
        displayName: 'Vercel',
        protectionFlags: { ...PROTECTION_FLAGS_ON, protectionReason: 'gmail_important' },
      },
    ]);
    renderScreen();

    expect(await screen.findByText(/you replied at least 3 times/)).toBeInTheDocument();
    expect(screen.getByText(/you starred a message/)).toBeInTheDocument();
    expect(screen.getByText(/Gmail marks it important/)).toBeInTheDocument();
  });

  it('leads with the protection shielding the most unread mail', async () => {
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Quiet', unreadInboxCount: 2, inboxCount: 3 },
      { ...BASE_ROW, id: 'b', displayName: 'Costly', unreadInboxCount: 145, inboxCount: 166 },
      { ...BASE_ROW, id: 'c', displayName: 'Middling', unreadInboxCount: 33, inboxCount: 34 },
    ]);
    renderScreen();

    await screen.findByText('Costly');
    const order = screen
      .getAllByRole('button', { name: /^Unprotect / })
      .map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual(['Unprotect Costly', 'Unprotect Middling', 'Unprotect Quiet']);
    expect(screen.getByText(/shielding 145 unread/)).toBeInTheDocument();
  });

  it('claims an ordering only when it actually ordered by one', async () => {
    // `unreadInboxCount` is optional on the wire. Against an API that
    // omits it every row sorts equal and the list falls back to name
    // order — while the header would still have claimed "most shielded
    // unread mail first", describing something that never happened.
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Zeta' },
      { ...BASE_ROW, id: 'b', displayName: 'Alpha' },
    ]);
    renderScreen();

    await screen.findByText('Alpha');
    expect(screen.queryByText(/most shielded unread mail first/i)).toBeNull();
    // The rest of the header still stands — it is a fact about the list.
    expect(screen.getByText(/Bulk and automatic actions skip these senders/)).toBeInTheDocument();
  });

  it('claims the ordering when the data supports it', async () => {
    // Two-sided: suppressing the claim when unknown must not suppress
    // it when true.
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Zeta', unreadInboxCount: 9 },
      { ...BASE_ROW, id: 'b', displayName: 'Alpha', unreadInboxCount: 1 },
    ]);
    renderScreen();

    await screen.findByText('Zeta');
    expect(screen.getByText(/most shielded unread mail first/i)).toBeInTheDocument();
  });

  it('never prints a fabricated "shielding 0" when nothing is shielded', async () => {
    // Absent (an API predating the field) and zero are different facts,
    // and neither is a measurement worth rendering.
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Empty inbox', unreadInboxCount: 0, inboxCount: 0 },
      { ...BASE_ROW, id: 'b', displayName: 'Unknown' },
    ]);
    renderScreen();

    await screen.findByText('Empty inbox');
    expect(screen.queryByText(/shielding 0 unread/)).toBeNull();
    expect(screen.queryByText(/shielding NaN/)).toBeNull();
    // Both rows still say why they are protected — an unknown shielded
    // count must not suppress the reason.
    expect(screen.getAllByText(/you marked it Protected/)).toHaveLength(2);
  });

  it('removes protection in place, without a trip to the detail page', async () => {
    // 55 wrong protections used to mean 55 round trips through
    // /senders/[id], which is why nobody ever corrected them.
    let patchedBody: unknown = null;
    let patchedPath: string | null = null;
    installFetchStub([
      {
        method: 'PATCH',
        path: /\/api\/senders\/.+\/policy$/,
        respond: (req, url) => {
          patchedPath = url.pathname;
          return req.text().then((body) => {
            patchedBody = JSON.parse(body || '{}');
            return jsonOk({
              data: { isProtected: false, protectionReason: 'starred', protectionSetAt: null },
            });
          });
        },
      },
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) =>
          jsonOk({
            data:
              url.searchParams.get('protected') === 'true'
                ? [{ ...BASE_ROW, id: 'sid-1', displayName: 'GetYourGuide' }]
                : [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          }),
      },
    ]);
    renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Unprotect GetYourGuide' }));

    await waitFor(() => expect(patchedBody).not.toBeNull());
    expect(patchedPath).toBe('/api/senders/sid-1/policy');
    expect(patchedBody).toEqual({ isProtected: false });
  });
});
