/**
 * Tests for `BriefScreen` (D61, D63, D67, D69, D70).
 *
 * Covers:
 *   - D211 / D212 edge branches: loading, error, 404-not-yet, populated,
 *     D70 quiet-inbox.
 *   - D63 — 3 sections render with correct headings + counts.
 *   - D62 — `via template` provenance marker shown when fallback ran;
 *     happy-path Haiku case stays silent.
 *   - D61 — mark-opened mutation fires exactly once when `openedAt` is
 *     null on the snapshot; does NOT fire when already opened.
 *   - D70 — verbatim quiet-inbox copy.
 *   - Pure helpers (formatRunDate, truncate, domainOf, gmailHref).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import {
  BriefScreen,
  domainOf,
  coveredDateOf,
  formatRunDate,
  gmailHref,
  senderSearchHref,
  truncate,
} from './brief-screen';
import type { BriefWire } from '@/lib/api/brief';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: {} }),
  getActiveMailboxEmail: () => 'active+mailbox@example.com',
}));

const SENDER_ID_NEWS = 'aaaaaaaa-0000-4000-8000-000000000001';

const BASE_BRIEF: BriefWire = {
  id: '11111111-1111-1111-1111-111111111111',
  runDateLocal: '2026-05-24',
  generatedBy: 'llm_haiku',
  briefPayload: {
    narrative: '2 emails need replies, 1 FYI, and 4 newsletters you can archive.',
    reply: [
      {
        senderKey: 'sk-boss',
        senderName: 'Boss',
        senderEmail: 'boss@example.com',
        subject: 'Q4 plan review',
        messageIds: ['m-boss-1'],
      },
      {
        senderKey: 'sk-vendor',
        senderName: 'Vendor Co',
        senderEmail: 'billing@vendor.com',
        subject: 'Invoice attached',
        messageIds: ['m-vendor-1'],
      },
    ],
    fyi: [
      {
        senderKey: 'sk-bank',
        senderName: 'Bank',
        senderEmail: 'noreply@bank.com',
        subject: 'Statement ready',
        messageIds: ['m-bank-1'],
      },
    ],
    noise: [
      {
        senderKey: 'sk-news',
        senderName: 'Newsletter Daily',
        messageCount: 4,
        messageIds: ['m-news-1', 'm-news-2', 'm-news-3', 'm-news-4'],
      },
    ],
  },
  generatedAt: '2026-05-25T08:00:00Z',
  openedAt: '2026-05-25T08:30:00Z',
  emailSentAt: null,
  feedbackRating: null,
  noiseSenders: [{ senderKey: 'sk-news', senderId: SENDER_ID_NEWS, isProtected: false }],
};

/** A frozen Brief from the day before BASE_BRIEF (D61 history). */
const PAST_BRIEF: BriefWire = {
  ...BASE_BRIEF,
  id: '22222222-2222-2222-2222-222222222222',
  runDateLocal: '2026-05-23',
  openedAt: null,
  briefPayload: {
    ...BASE_BRIEF.briefPayload,
    narrative: '',
    reply: [
      {
        senderKey: 'sk-landlord',
        senderName: 'Sunrise Property',
        senderEmail: 'leases@sunrise.example',
        subject: 'Lease renewal needs signing',
        messageIds: ['m-land-1'],
      },
    ],
    fyi: [],
    noise: [],
  },
};

/** Today + one earlier day, newest first — the endpoint's own order. */
function historyHandler(rows: BriefWire[] = [BASE_BRIEF, PAST_BRIEF]) {
  return {
    method: 'GET' as const,
    path: '/api/briefs',
    respond: () => jsonOk({ data: rows }),
  };
}

function renderScreen() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <BriefScreen />
    </QueryWrapper>,
  );
}

describe('BriefScreen — edge states', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('shows the loading skeleton while the fetch is in-flight', () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => new Promise<Response>(() => {}),
      },
    ]);

    renderScreen();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the "Brief lands soon" branch on 404 (worker has not ticked yet)', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          new Response(JSON.stringify({ message: 'Brief not found for today.' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /your brief lands soon/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('renders the generic error branch on 500', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonServerError(),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /couldn[’']t load your brief/i }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/needs attention/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('D70 — quiet-inbox empty state renders verbatim copy when all sections are empty', async () => {
    const empty: BriefWire = {
      ...BASE_BRIEF,
      briefPayload: { reply: [], fyi: [], noise: [], narrative: '' },
    };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: empty }),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /your inbox was quiet yesterday\./i }),
      ).toBeInTheDocument(),
    );
    const feedback = screen.getByRole('group', { name: /how was this brief/i });
    expect(within(feedback).getByRole('button', { name: 'Useful' })).toBeInTheDocument();
    expect(within(feedback).getByRole('button', { name: 'Not useful' })).toBeInTheDocument();
    expect(
      within(feedback).getByRole('button', { name: 'Something looks wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/enjoy the morning — we.ll be back tomorrow\./i)).toBeInTheDocument();
  });
});

describe('BriefScreen — populated', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('D63 — renders Reply / FYI / Noise headings with correct counts', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2$/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: /fyi · 1$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /noise · 1 · 4 messages/i })).toBeInTheDocument();
  });

  it('dates the Brief by the day it covers, not the day it ran', async () => {
    // Consumer-level on purpose. coveredDateOf can be correct as a pure
    // function while the header still renders runDateLocal — that gap is
    // exactly the bug, so asserting the helper alone would not catch it.
    // BASE_BRIEF ran on Sun 2026-05-24 and covers Sat 2026-05-23.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();

    await waitFor(() => expect(screen.getByText('Sat, May 23')).toBeInTheDocument());
    expect(screen.queryByText('Sun, May 24')).not.toBeInTheDocument();
  });

  it('shows "of N" only when the cap actually dropped something', async () => {
    // BASE_BRIEF has 2 reply rows. With replyTotal 2 nothing was
    // dropped, so "2 of 2" would be the cap describing itself — the
    // exact defect. With replyTotal 8, "2 of 8" is real information.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          jsonOk({
            data: {
              ...BASE_BRIEF,
              briefPayload: { ...BASE_BRIEF.briefPayload, replyTotal: 2, fyiTotal: 1 },
            },
          }),
      },
    ]);

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: /reply · 2 of 2/i })).not.toBeInTheDocument();
  });

  it('names the real total when the cap truncated the section', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          jsonOk({
            data: {
              ...BASE_BRIEF,
              briefPayload: { ...BASE_BRIEF.briefPayload, replyTotal: 8, fyiTotal: 5 },
            },
          }),
      },
    ]);

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2 of 8/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: /fyi · 1 of 5/i })).toBeInTheDocument();
  });

  it('falls back to a plain count on a Brief frozen before totals existed', async () => {
    // D69 freezes rows once written, so payloads with no replyTotal are
    // a real shape the screen must render — not a hypothetical.
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2$/i })).toBeInTheDocument(),
    );
  });

  it('renders the narrative pre-amble when non-empty', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText(/2 emails need replies/i)).toBeInTheDocument());
  });

  it('D62 — `via template` marker shows only when fallback ran', async () => {
    const templated: BriefWire = { ...BASE_BRIEF, generatedBy: 'template' };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: templated }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByText(/standard summary/i)).toBeInTheDocument());
  });

  it('D62 — `via template` marker hidden on the Haiku happy path', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2$/i })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/via template/i)).not.toBeInTheDocument();
  });

  it('Gmail deep-links use the first message id of each row', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();
    const links = await screen.findAllByRole('link', { name: /open in gmail/i });
    // 2 reply + 1 fyi + 1 noise = 4 deep links.
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute(
      'href',
      'https://mail.google.com/mail/?authuser=active%2Bmailbox%40example.com#all/m-boss-1',
    );
    expect(links[0]?.getAttribute('href')).not.toContain('/u/0');
  });

  it('links the frozen snapshot to Activity and every item to a relevant sender search', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();
    expect(await screen.findByRole('link', { name: /see what changed/i })).toHaveAttribute(
      'href',
      '/activity',
    );
    const senderLinks = screen.getAllByRole('link', { name: /review sender/i });
    expect(senderLinks).toHaveLength(4);
    expect(senderLinks[0]).toHaveAttribute('href', '/senders?q=boss%40example.com');
    expect(senderLinks[3]).toHaveAttribute('href', '/senders?q=Newsletter%20Daily');
  });
});

describe('BriefScreen — D61 mark-opened mutation', () => {
  beforeEach(() => installFetchStub([]));
  afterEach(() => resetFetchStub());

  it('fires POST /briefs/:id/mark-opened exactly once when openedAt is null', async () => {
    let postCount = 0;
    const unopened: BriefWire = { ...BASE_BRIEF, openedAt: null };
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: unopened }),
      },
      {
        method: 'POST',
        path: `/api/briefs/${unopened.id}/mark-opened`,
        respond: () => {
          postCount += 1;
          return jsonOk({
            data: { id: unopened.id, openedAt: '2026-05-25T09:00:00Z' },
          });
        },
      },
    ]);

    renderScreen();
    await waitFor(() => expect(postCount).toBe(1));
  });

  it('does NOT fire mark-opened when openedAt is already set', async () => {
    let postCount = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
      {
        method: 'POST',
        path: `/api/briefs/${BASE_BRIEF.id}/mark-opened`,
        respond: () => {
          postCount += 1;
          return jsonOk({
            data: { id: BASE_BRIEF.id, openedAt: '2026-05-25T09:00:00Z' },
          });
        },
      },
    ]);

    renderScreen();
    // Wait for the populated content so we know the effect had a
    // chance to run; then assert no POST was made.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /reply · 2$/i })).toBeInTheDocument(),
    );
    expect(postCount).toBe(0);
  });
});

describe('BriefScreen — pure helpers', () => {
  it('formatRunDate produces a friendly local label without TZ shift', () => {
    // The Date input is parsed as UTC midnight; the formatter renders
    // the calendar fields verbatim so no off-by-one ever appears. The
    // exact string is asserted because this label is server-rendered
    // into hydrated HTML: it must not vary with the runtime locale or
    // React discards the server tree (error #418; e2e hydration-smoke).
    expect(formatRunDate('2026-05-24')).toBe('Sun, May 24');
  });

  it('coveredDateOf steps back to the day the Brief actually covers', () => {
    // run_date_local is the GENERATION date; the window is the day
    // before it. Rendering the raw value dated every Brief a day late.
    expect(coveredDateOf('2026-08-26')).toBe('2026-08-25');
    // Month boundary.
    expect(coveredDateOf('2026-09-01')).toBe('2026-08-31');
    // Year boundary.
    expect(coveredDateOf('2026-01-01')).toBe('2025-12-31');
    // Leap day — 2028 is a leap year, so Mar 1 steps back to Feb 29.
    expect(coveredDateOf('2028-03-01')).toBe('2028-02-29');
    // Non-leap year does not invent one.
    expect(coveredDateOf('2027-03-01')).toBe('2027-02-28');
  });

  it('coveredDateOf passes through malformed input unchanged', () => {
    expect(coveredDateOf('not-a-date')).toBe('not-a-date');
    expect(coveredDateOf('')).toBe('');
  });

  it('formatRunDate passes through malformed input unchanged', () => {
    expect(formatRunDate('not-a-date')).toBe('not-a-date');
  });

  it('truncate respects the 70-char Reply/FYI subject limit', () => {
    expect(truncate('short', 70)).toBe('short');
    const long = 'a'.repeat(100);
    const out = truncate(long, 70);
    expect(out.length).toBe(70);
    expect(out.endsWith('…')).toBe(true);
  });

  it('domainOf extracts the domain after the last @', () => {
    expect(domainOf('boss@example.com')).toBe('example.com');
    expect(domainOf('user+tag@sub.example.co.uk')).toBe('sub.example.co.uk');
    expect(domainOf('no-at-sign')).toBe('no-at-sign');
  });

  it('gmailHref returns a permalink for a message id, null for empty', () => {
    expect(gmailHref('active+mailbox@example.com', 'm-abc')).toBe(
      'https://mail.google.com/mail/?authuser=active%2Bmailbox%40example.com#all/m-abc',
    );
    expect(gmailHref('active+mailbox@example.com', undefined)).toBeNull();
    expect(gmailHref(null, 'm-abc')).toBeNull();
  });

  it('senderSearchHref preserves an exact shareable sender query', () => {
    expect(senderSearchHref('Billing + Reports')).toBe('/senders?q=Billing%20%2B%20Reports');
  });
});

describe('BriefScreen — D61 history', () => {
  beforeEach(() => {
    installFetchStub([
      { method: 'GET', path: '/api/briefs/today', respond: () => jsonOk({ data: BASE_BRIEF }) },
      historyHandler(),
    ]);
  });

  it('offers the days that exist and opens on the latest', async () => {
    renderScreen();

    const picker = await screen.findByLabelText('Brief day');
    // Labels are the COVERED day, not the run date — 2026-05-24 ran over
    // Sat the 23rd, and 2026-05-23 over Fri the 22nd.
    expect(
      within(picker).getByRole('option', { name: /Sat, May 23 — latest/ }),
    ).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /^Fri, May 22$/ })).toBeInTheDocument();
    // Latest is selected, and today's content is on screen.
    expect((picker as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Q4 plan review')).toBeInTheDocument();
  });

  it('renders the chosen day in place', async () => {
    const user = userEvent.setup();
    renderScreen();

    const picker = await screen.findByLabelText('Brief day');
    await user.selectOptions(picker, '2026-05-23');

    await waitFor(() =>
      expect(screen.getByText('Lease renewal needs signing')).toBeInTheDocument(),
    );
    // Today's rows are gone — this is a replacement, not an append.
    expect(screen.queryByText('Q4 plan review')).not.toBeInTheDocument();
  });

  it('does not mark a past Brief opened', async () => {
    // opened_at is D61's first-view tracker for the day a Brief was
    // delivered. Browsing back through history must not rewrite it.
    const posted: string[] = [];
    installFetchStub([
      { method: 'GET', path: '/api/briefs/today', respond: () => jsonOk({ data: BASE_BRIEF }) },
      historyHandler(),
      {
        method: 'POST',
        path: /\/api\/briefs\/[^/]+\/mark-opened/,
        respond: (_req, url) => {
          posted.push(url.pathname);
          return jsonOk({ data: { openedAt: '2026-05-25T09:00:00Z' } });
        },
      },
    ]);

    const user = userEvent.setup();
    renderScreen();

    const picker = await screen.findByLabelText('Brief day');
    await user.selectOptions(picker, '2026-05-23');
    await waitFor(() =>
      expect(screen.getByText('Lease renewal needs signing')).toBeInTheDocument(),
    );

    expect(posted).toEqual([]);
  });

  it('stops saying "yesterday" once the switcher reaches a past day', async () => {
    // The intro and the Noise heading both anchored their counts to
    // "yesterday". That is true of the latest Brief and false of every
    // other one the day switcher can now reach.
    const user = userEvent.setup();
    renderScreen();

    // Latest: "yesterday" is correct and stays.
    await waitFor(() => expect(screen.getByText(/yesterday's mail/i)).toBeInTheDocument());
    expect(
      screen.getByRole('heading', { name: /noise .*messages yesterday/i }),
    ).toBeInTheDocument();

    await user.selectOptions(await screen.findByLabelText('Brief day'), '2026-05-23');

    // Past day: named, not "yesterday". PAST_BRIEF ran 2026-05-23 and
    // covers Fri 2026-05-22.
    await waitFor(() => expect(screen.getByText(/mail from Fri, May 22/i)).toBeInTheDocument());
    expect(screen.queryByText(/yesterday's mail/i)).not.toBeInTheDocument();
  });

  it('hides the switcher and still renders today when history fails', async () => {
    // History is secondary. A range read that 500s must cost the user
    // the switcher and nothing else.
    installFetchStub([
      { method: 'GET', path: '/api/briefs/today', respond: () => jsonOk({ data: BASE_BRIEF }) },
      { method: 'GET', path: '/api/briefs', respond: () => jsonServerError() },
    ]);

    renderScreen();

    await waitFor(() => expect(screen.getByText('Q4 plan review')).toBeInTheDocument());
    expect(screen.queryByLabelText('Brief day')).not.toBeInTheDocument();
    // The plain date label takes its place.
    expect(screen.getByText('Sat, May 23')).toBeInTheDocument();
  });

  it('hides the switcher when only one Brief exists', async () => {
    installFetchStub([
      { method: 'GET', path: '/api/briefs/today', respond: () => jsonOk({ data: BASE_BRIEF }) },
      historyHandler([BASE_BRIEF]),
    ]);

    renderScreen();

    await waitFor(() => expect(screen.getByText('Q4 plan review')).toBeInTheDocument());
    expect(screen.queryByLabelText('Brief day')).not.toBeInTheDocument();
  });
});
