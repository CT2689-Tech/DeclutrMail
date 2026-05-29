/**
 * Tests for `BriefScreen` (D61, D63, D67, D69, D70).
 *
 * Covers:
 *   - D211 / D212 edge branches: loading, error, 404-not-yet, populated,
 *     D70 quiet-inbox.
 *   - D63 — 3 sections render with correct headings + counts.
 *   - D67 — VIP star renders inline on a Reply row.
 *   - D62 — `via template` provenance marker shown when fallback ran;
 *     happy-path Haiku case stays silent.
 *   - D61 — mark-opened mutation fires exactly once when `openedAt` is
 *     null on the snapshot; does NOT fire when already opened.
 *   - D70 — verbatim quiet-inbox copy.
 *   - Pure helpers (formatRunDate, truncate, domainOf, gmailHref).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { BriefScreen, domainOf, formatRunDate, gmailHref, truncate } from './brief-screen';
import type { BriefWire } from '@/lib/api/brief';

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
        isVip: true,
        messageIds: ['m-boss-1'],
      },
      {
        senderKey: 'sk-vendor',
        senderName: 'Vendor Co',
        senderEmail: 'billing@vendor.com',
        subject: 'Invoice attached',
        isVip: false,
        messageIds: ['m-vendor-1'],
      },
    ],
    fyi: [
      {
        senderKey: 'sk-bank',
        senderName: 'Bank',
        senderEmail: 'noreply@bank.com',
        subject: 'Statement ready',
        isVip: false,
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
};

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
      expect(screen.getByRole('heading', { name: /reply · 2 of 6/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: /fyi · 1 of 4/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /noise · 1 · 4 messages/i })).toBeInTheDocument();
  });

  it('D67 — VIP star renders on the Reply row marked isVip', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () => jsonOk({ data: BASE_BRIEF }),
      },
    ]);

    renderScreen();
    await waitFor(() => expect(screen.getByLabelText('VIP sender')).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText(/via template/i)).toBeInTheDocument());
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
      expect(screen.getByRole('heading', { name: /reply · 2 of 6/i })).toBeInTheDocument(),
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
    expect(links[0]).toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#all/m-boss-1');
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
      expect(screen.getByRole('heading', { name: /reply · 2 of 6/i })).toBeInTheDocument(),
    );
    expect(postCount).toBe(0);
  });
});

describe('BriefScreen — pure helpers', () => {
  it('formatRunDate produces a friendly local label without TZ shift', () => {
    // The Date input is parsed as UTC midnight; the formatter renders
    // the calendar fields verbatim so no off-by-one ever appears.
    const out = formatRunDate('2026-05-24');
    // Expect a weekday + month-name fragment; locale-independent.
    expect(out).toMatch(/May/);
    expect(out).toMatch(/24/);
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
    expect(gmailHref('m-abc')).toBe('https://mail.google.com/mail/u/0/#all/m-abc');
    expect(gmailHref(undefined)).toBeNull();
  });
});
