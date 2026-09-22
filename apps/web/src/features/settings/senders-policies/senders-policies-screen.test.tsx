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

  it('disables prior-result actions and pagination while a new search resolves', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) =>
          url.searchParams.has('q')
            ? new Promise<Response>(() => {})
            : jsonOk({
                data: [BASE_ROW],
                meta: {
                  pagination: { nextCursor: 'next', hasMore: true, limit: 50 },
                  query: { totalMatching: 513, globalMaxTotal: 900 },
                },
              }),
      },
    ]);
    renderScreen();
    const action = await screen.findByRole('button', { name: 'Unprotect Sender A' });
    expect(action).toBeEnabled();
    const more = screen.getByRole('button', { name: 'Show more protected senders' });
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'remote');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    await waitFor(() => expect(action).toBeDisabled());
    expect(more.isConnected && more.matches(':enabled')).toBe(false);
    expect(screen.getByText('Updating…')).toBeInTheDocument();
    expect(screen.queryByText('513 senders')).not.toBeInTheDocument();
  });

  it('searches the complete protected collection on the server and clears back to all results', async () => {
    const requests: string[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) => {
          requests.push(url.search);
          const searched = url.searchParams.get('q') === 'remote';
          return jsonOk({
            data: [
              {
                ...BASE_ROW,
                id: searched ? 'remote' : 'a',
                displayName: searched ? 'Remote result' : 'Sender A',
              },
            ],
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: searched ? 1 : 513, globalMaxTotal: 900 },
            },
          });
        },
      },
    ]);
    renderScreen();
    expect(await screen.findByText('513 senders')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox'), 'remote');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(await screen.findByText('Remote result')).toBeInTheDocument();
    expect(
      requests.some((query) => query.includes('q=remote') && query.includes('protected=true')),
    ).toBe(true);
    expect(screen.getByText('1 sender')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Sender A')).toBeInTheDocument();
    expect(screen.getByText('513 senders')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all filters/i })).toHaveAttribute(
      'href',
      '/senders?activity=all&protected=true',
    );
  });

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

  it('keeps the loaded rows when "Show more" fails — the footer owns that failure', async () => {
    // TanStack v5 flips the query-wide `isError` on ANY failed fetch
    // while data is retained, so the old whole-screen gate replaced 50
    // loaded rows with "We couldn't load protected senders" after a
    // failed page-2 — false about what happened, and it discarded the
    // rows. The gate is now `isError && data == null`; this pins the
    // retained-data path (same class `activity-screen.tsx` documents).
    installFetchStub([
      {
        method: 'GET',
        path: '/api/senders',
        respond: (_req, url) =>
          url.searchParams.get('cursor') === 'page-2'
            ? jsonServerError()
            : jsonOk({
                data: [{ ...BASE_ROW, id: 'p1', displayName: 'Page 1 Sender' }],
                meta: { pagination: { nextCursor: 'page-2', hasMore: true, limit: 50 } },
              }),
      },
    ]);
    renderScreen();
    await waitFor(() => expect(screen.getByText('Page 1 Sender')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /show more protected senders/i }));

    // The next-page failure surfaces IN the footer…
    await waitFor(() => expect(screen.getByText(/Couldn.t load more\./i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /show more protected senders/i })).toHaveTextContent(
      /Try again/i,
    );
    // …while the loaded rows and the whole-screen surface stay intact.
    expect(screen.getByText('Page 1 Sender')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load protected senders/i)).toBeNull();
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

    expect(await screen.findByText(/you wrote to them at least 3 times/)).toBeInTheDocument();
    expect(screen.getByText(/you starred a message/)).toBeInTheDocument();
    expect(screen.getByText(/Gmail marks it important/)).toBeInTheDocument();
  });

  it('says so when a correspondence shield can no longer be confirmed (F010)', async () => {
    // mig 0063 corrected what the count behind `replied` measures, so
    // some shields rest on evidence that never existed. The row must not
    // keep repeating the old claim — and must not imply the shield was
    // removed, because it was not.
    stubProtectedPage([
      {
        ...BASE_ROW,
        id: 'a',
        displayName: 'Bounce Notifier',
        protectionFlags: {
          ...PROTECTION_FLAGS_ON,
          protectionReason: 'replied',
          protectionEvidenceCurrent: false,
        },
      },
    ]);
    renderScreen();

    expect(
      await screen.findByText(/we can no longer confirm you wrote to them/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/you wrote to them at least 3 times/)).not.toBeInTheDocument();
  });

  it.each([
    ['null — mailbox has no outbound indexed', null],
    ['undefined — an API predating the field', undefined],
    ['true — checked and holding', true],
  ])('keeps the recorded reason when evidence is %s', async (_label, evidence) => {
    // THE BLIND CASE, from the display side. Only an explicit `false`
    // may contradict a recorded reason; anything else is "no claim", and
    // coercing it would tell the user their shields are unfounded on
    // every mailbox we simply cannot measure.
    stubProtectedPage([
      {
        ...BASE_ROW,
        id: 'a',
        displayName: 'Colleague',
        protectionFlags: {
          ...PROTECTION_FLAGS_ON,
          protectionReason: 'replied',
          ...(evidence === undefined ? {} : { protectionEvidenceCurrent: evidence }),
        },
      },
    ]);
    renderScreen();

    expect(await screen.findByText(/you wrote to them at least 3 times/)).toBeInTheDocument();
    expect(
      screen.queryByText(/we can no longer confirm you wrote to them/),
    ).not.toBeInTheDocument();
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

  it('states the skip guard once, with its single-sender exception beside it', async () => {
    // The intro and the list header used to say the same sentence twice.
    // The header owns it (it is a fact about the list); the intro keeps
    // only what it alone adds.
    stubProtectedPage([{ ...BASE_ROW, id: 'a', displayName: 'Alpha' }]);
    renderScreen();

    await screen.findByText('Alpha');
    const guard = screen.getAllByText(/bulk and automatic actions skip/i);
    expect(guard).toHaveLength(1);
    expect(guard[0]).toHaveTextContent(/one sender yourself still applies/i);
  });

  it('sorts an unmeasured row after a known zero, never as if it were zero', async () => {
    // The unmeasured row is named FIRST alphabetically on purpose: with
    // `?? 0` it ties the known zero and the name tiebreaker floats it
    // up, so this ordering is the only thing that distinguishes
    // "unknown sorts last" from "unknown is zero".
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Aardvark (unmeasured)' },
      { ...BASE_ROW, id: 'b', displayName: 'KnownZero', unreadInboxCount: 0 },
      { ...BASE_ROW, id: 'c', displayName: 'Costly', unreadInboxCount: 12 },
    ]);
    renderScreen();

    await screen.findByText('Costly');
    const order = screen
      .getAllByRole('button', { name: /^Unprotect / })
      .map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual([
      'Unprotect Costly',
      'Unprotect KnownZero',
      'Unprotect Aardvark (unmeasured)',
    ]);
  });

  it('never renders an unknown cadence as a confident zero', async () => {
    // On this screen a confident "0 in last 90d" reads as "this sender
    // stopped mailing you" — an argument for unprotecting that the data
    // never made. `null` means nothing indexed, not zero.
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Unknown cadence', monthlyVolume: null },
      { ...BASE_ROW, id: 'b', displayName: 'Real zero', monthlyVolume: 0 },
    ]);
    renderScreen();

    await screen.findByText('Unknown cadence');
    // Exactly one row may claim zero — the one that measured zero.
    expect(screen.getAllByText(/0 in last 90d/)).toHaveLength(1);
  });

  it('makes no ordering claim — the sentence is gone, the sort is not', async () => {
    // The sort only ranks what is LOADED and only when every row carries
    // the measure; rather than qualify a sentence about it, the page
    // says nothing. The ordering itself is asserted above.
    stubProtectedPage([
      { ...BASE_ROW, id: 'a', displayName: 'Zeta', unreadInboxCount: 9 },
      { ...BASE_ROW, id: 'b', displayName: 'Alpha', unreadInboxCount: 1 },
    ]);
    renderScreen();

    await screen.findByText('Zeta');
    expect(screen.queryByText(/most shielded/i)).toBeNull();
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
