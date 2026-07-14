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
  isVip: false,
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
    expect(screen.getByRole('heading', { name: /standing policies/i })).toBeInTheDocument();
  });

  it('fires exactly one server-filtered request per section (protected + vip)', async () => {
    const seenUrls: URL[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          seenUrls.push(url);
          if (url.searchParams.get('vip') === 'true') {
            return jsonOk({
              data: [],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
            });
          }
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
    // make exactly ONE request per section — anything more is a
    // regression of the storm (and would not survive a 5k mailbox).
    expect(seenUrls).toHaveLength(2);
    const protectedReq = seenUrls.find((u) => u.searchParams.get('protected') === 'true');
    const vipReq = seenUrls.find((u) => u.searchParams.get('vip') === 'true');
    expect(protectedReq).toBeDefined();
    expect(protectedReq!.searchParams.get('limit')).toBe('50');
    expect(vipReq).toBeDefined();
    expect(vipReq!.searchParams.get('limit')).toBe('50');
    // The two filters never compose on one request.
    expect(protectedReq!.searchParams.get('vip')).toBeNull();
    expect(vipReq!.searchParams.get('protected')).toBeNull();
  });

  it('lists each server-returned protected sender with a Manage link', async () => {
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
          if (url.searchParams.get('vip') === 'true') {
            return jsonOk({
              data: [],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
            });
          }
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
    const showMore = screen.getByRole('button', { name: /^show more$/i });

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
      within(alert).getByRole('heading', { name: /couldn[’']t load standing policies/i }),
    ).toBeInTheDocument();
    expect(within(alert).getByText(/existing policies remain active/i)).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: /try again/i }));

    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(protectedAttempts).toBe(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ── VIP section (U23) ─────────────────────────────────────────────

  const VIP_ROW = {
    ...BASE_ROW,
    id: 'v1',
    displayName: 'Mom',
    email: 'mom@example.com',
    protectionFlags: {
      isVip: true,
      isProtected: false,
      protectionReason: null,
      protectionSetAt: null,
    },
  };

  function installVipFixture(opts: { removed?: () => boolean } = {}) {
    const patches: Array<{ url: string; body: unknown }> = [];
    let vipRemoved = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          if (url.searchParams.get('vip') === 'true') {
            return jsonOk({
              data: vipRemoved ? [] : [VIP_ROW],
              meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
            });
          }
          return jsonOk({
            data: [],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          });
        },
      },
      {
        method: 'PATCH',
        path: /\/api\/senders\/[^/]+\/policy/,
        respond: async (req, url) => {
          patches.push({ url: url.pathname, body: await req.json() });
          vipRemoved = opts.removed ? opts.removed() : true;
          return jsonOk({
            data: {
              senderId: 'v1',
              policyType: null,
              isVip: false,
              isProtected: false,
              protectionReason: null,
              protectionSetAt: null,
              changed: true,
            },
          });
        },
      },
    ]);
    return patches;
  }

  it('lists VIP senders with Remove + Manage affordances', async () => {
    installVipFixture();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Mom')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /remove vip from mom/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage mom/i })).toHaveAttribute(
      'href',
      '/senders/v1',
    );
  });

  it('Remove PATCHes isVip:false via the existing policy route and the row leaves the list', async () => {
    const patches = installVipFixture();
    renderScreen();
    await waitFor(() => expect(screen.getByText('Mom')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /remove vip from mom/i }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]!.url).toBe('/api/senders/v1/policy');
    expect(patches[0]!.body).toEqual({ isVip: false });
    // The mutation invalidates sendersKeys.all → the vip list refetches
    // (now empty) and the row disappears.
    await waitFor(() => expect(screen.queryByText('Mom')).not.toBeInTheDocument());
    expect(screen.getByText(/No VIP senders yet/i)).toBeInTheDocument();
  });

  it('renders the VIP empty state without blanking the Protected section', async () => {
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
          return jsonOk({
            data: [{ ...BASE_ROW, id: 'a', displayName: 'Stripe' }],
            meta: { pagination: { nextCursor: null, hasMore: false, limit: 50 } },
          });
        },
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Stripe')).toBeInTheDocument());
    expect(screen.getByText(/No VIP senders yet/i)).toBeInTheDocument();
  });
});
