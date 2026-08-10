/**
 * D65 Noise bulk-archive integration tests, driven through the real
 * screen and the real API client.
 *
 * The two properties worth a test here are the two that would be a
 * shipped defect rather than a cosmetic one:
 *
 *   1. D226 ORDER — the archive click opens a preview and nothing else.
 *      No `POST /api/actions` may leave the browser before a live count
 *      has rendered and the user has confirmed it.
 *   2. D245 EXCLUSION — a Protected sender is never in the request, is
 *      never counted by the CTA, and says on-screen why it is out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import type { BriefWire } from '@/lib/api/brief';

import { BriefScreen } from './brief-screen';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: {} }),
  getActiveMailboxEmail: () => 'active+mailbox@example.com',
}));

const ID_NEWS = 'aaaaaaaa-0000-4000-8000-000000000001';
const ID_SHOP = 'aaaaaaaa-0000-4000-8000-000000000002';
const ID_BOSS = 'aaaaaaaa-0000-4000-8000-000000000003';

const BRIEF: BriefWire = {
  id: '11111111-1111-1111-1111-111111111111',
  runDateLocal: '2026-05-24',
  generatedBy: 'llm_haiku',
  briefPayload: {
    narrative: 'Three noisy senders.',
    reply: [],
    fyi: [],
    noise: [
      {
        senderKey: 'sk-news',
        senderName: 'Newsletter Daily',
        messageCount: 4,
        messageIds: ['m-news-1'],
      },
      { senderKey: 'sk-shop', senderName: 'Old Navy', messageCount: 3, messageIds: ['m-shop-1'] },
      { senderKey: 'sk-boss', senderName: 'Big Boss', messageCount: 2, messageIds: ['m-boss-1'] },
    ],
  },
  generatedAt: '2026-05-25T08:00:00Z',
  openedAt: '2026-05-25T08:30:00Z',
  emailSentAt: null,
  feedbackRating: null,
  // Big Boss is Protected (D245); the other two are actionable.
  noiseSenders: [
    { senderKey: 'sk-news', senderId: ID_NEWS, isProtected: false },
    { senderKey: 'sk-shop', senderId: ID_SHOP, isProtected: false },
    { senderKey: 'sk-boss', senderId: ID_BOSS, isProtected: true },
  ],
};

const BULK_PREVIEW = {
  senders: [
    {
      senderId: ID_NEWS,
      name: 'Newsletter Daily',
      counts: { all: 210, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
      protected: false,
    },
    {
      senderId: ID_SHOP,
      name: 'Old Navy',
      counts: { all: 141, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
      protected: false,
    },
  ],
  totals: { all: 351, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
  protectedCount: 0,
};

/** Bodies of every `POST /api/actions` the screen sent, in order. */
let enqueued: Array<Record<string, unknown>>;

function briefHandler() {
  return {
    method: 'GET' as const,
    path: '/api/briefs/today',
    respond: () => jsonOk({ data: BRIEF }),
  };
}

function bulkPreviewHandler(respond?: () => Response) {
  return {
    method: 'POST' as const,
    path: '/api/actions/preview/bulk',
    respond: respond ?? (() => jsonOk({ data: BULK_PREVIEW })),
  };
}

function enqueueHandler() {
  return {
    method: 'POST' as const,
    path: '/api/actions',
    respond: async (req: Request) => {
      enqueued.push((await req.json()) as Record<string, unknown>);
      return jsonOk({
        data: {
          batchId: 'batch-1',
          status: 'queued',
          senderCount: 2,
          requestedTotal: 351,
          wakeAt: null,
          skipped: [],
        },
      });
    },
  };
}

function renderScreen() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <BriefScreen />
    </QueryWrapper>,
  );
}

/** The Noise section's archive CTA. */
function archiveButton() {
  return screen.getByRole('button', { name: /^Archive \d+ senders?$/ });
}

async function openPreview() {
  await waitFor(() => expect(archiveButton()).toBeEnabled());
  fireEvent.click(archiveButton());
  return await screen.findByRole('dialog');
}

describe('Brief Noise bulk archive (D65)', () => {
  beforeEach(() => {
    enqueued = [];
    installFetchStub([]);
  });
  afterEach(() => resetFetchStub());

  it('checks every actionable Noise sender by default (D65)', async () => {
    installFetchStub([briefHandler()]);
    renderScreen();

    const news = await screen.findByRole('checkbox', {
      name: /include newsletter daily in the archive/i,
    });
    const shop = screen.getByRole('checkbox', { name: /include old navy in the archive/i });
    expect(news).toBeChecked();
    expect(shop).toBeChecked();
    // 2 actionable senders, not 3 — Big Boss is Protected.
    expect(archiveButton()).toHaveAccessibleName('Archive 2 senders');
  });

  it('excludes a Protected sender visibly, with the reason on the row (D245)', async () => {
    installFetchStub([briefHandler()]);
    renderScreen();

    await screen.findByText(/Protected — kept out of bulk actions/i);
    expect(
      screen.queryByRole('checkbox', { name: /include big boss in the archive/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/1 sender below cannot be included/i)).toBeInTheDocument();
  });

  it('keeps the frozen yesterday count on a Protected row (D69)', async () => {
    installFetchStub([briefHandler()]);
    renderScreen();
    // The snapshot still reports what it measured — the row states the
    // exclusion in addition to the count, never instead of it.
    await screen.findByText(/2 messages yesterday · Protected/i);
  });

  it('opens the preview on the archive click and sends NO mutation (D226 order)', async () => {
    installFetchStub([briefHandler(), bulkPreviewHandler(), enqueueHandler()]);
    renderScreen();

    const dialog = await openPreview();
    expect(within(dialog).getByText(/before anything changes/i)).toBeInTheDocument();
    // The whole point: the click that opens a preview must not mutate.
    expect(enqueued).toHaveLength(0);
  });

  it('keeps confirm disabled until a live count has landed', async () => {
    installFetchStub([
      briefHandler(),
      // The preview never resolves — confirm must stay locked, not fall
      // back to some cached or assumed count.
      bulkPreviewHandler(() => new Promise<Response>(() => {}) as unknown as Response),
      enqueueHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    expect(within(dialog).getByRole('button', { name: /^Archive/ })).toBeDisabled();
    expect(within(dialog).getByText(/counting the inbox/i)).toBeInTheDocument();
    expect(enqueued).toHaveLength(0);
  });

  it('blocks confirm and offers a retry when the preview read fails', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(() => jsonServerError()),
      enqueueHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    await within(dialog).findByText(/couldn’t load a live preview/i);
    expect(within(dialog).getByRole('button', { name: /^Archive/ })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /retry preview/i })).toBeInTheDocument();
    expect(enqueued).toHaveLength(0);
  });

  it('shows the live inbox count, not the frozen Brief count, before confirming', async () => {
    installFetchStub([briefHandler(), bulkPreviewHandler(), enqueueHandler()]);
    renderScreen();

    const dialog = await openPreview();
    // 351 is what is in the inbox now; 7 is what yesterday held. The
    // preview must state the number that is about to move.
    await within(dialog).findByText('351');
    expect(within(dialog).getByText(/currently match in Inbox/i)).toBeInTheDocument();
  });

  it('sends one bulk archive for the checked senders only, after confirm (D226)', async () => {
    installFetchStub([briefHandler(), bulkPreviewHandler(), enqueueHandler()]);
    renderScreen();

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await waitFor(() => expect(enqueued).toHaveLength(1));
    expect(enqueued[0]).toMatchObject({
      selector: { type: 'senders', senderIds: [ID_NEWS, ID_SHOP] },
      primary: { type: 'archive', olderThanDays: null },
    });
    // The Protected sender never reaches the wire.
    expect(JSON.stringify(enqueued[0])).not.toContain(ID_BOSS);
  });

  it('drops an unchecked sender from the request', async () => {
    installFetchStub([
      briefHandler(),
      {
        method: 'POST',
        path: '/api/actions/preview/bulk',
        respond: () => jsonOk({ data: BULK_PREVIEW }),
      },
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () =>
          jsonOk({
            data: {
              sender: {
                id: ID_NEWS,
                name: 'Newsletter Daily',
                domain: 'news.example',
                lastSeenDays: 1,
                repliedCount: 0,
                monthly: 30,
              },
              counts: {
                all: 210,
                olderThan30d: 0,
                olderThan90d: 0,
                olderThan180d: 0,
                olderThan365d: 0,
              },
              recentMessages: {
                all: [],
                olderThan30d: [],
                olderThan90d: [],
                olderThan180d: [],
                olderThan365d: [],
              },
              recentSubjects: {
                all: [],
                olderThan30d: [],
                olderThan90d: [],
                olderThan180d: [],
                olderThan365d: [],
              },
              allMail: null,
              unsubAvailable: false,
              protected: false,
            },
          }),
      },
      enqueueHandler(),
    ]);
    renderScreen();

    const shop = await screen.findByRole('checkbox', {
      name: /include old navy in the archive/i,
    });
    fireEvent.click(shop);
    expect(shop).not.toBeChecked();
    await waitFor(() => expect(archiveButton()).toHaveAccessibleName('Archive 1 sender'));

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    // A single sender goes down the single-sender wire, not the bulk one.
    await waitFor(() => expect(enqueued).toHaveLength(1));
    expect(enqueued[0]).toMatchObject({
      selector: { type: 'sender', senderId: ID_NEWS },
      primary: { type: 'archive', olderThanDays: null },
    });
  });

  it('renders no archive control when nothing is actionable', async () => {
    installFetchStub([
      {
        method: 'GET',
        path: '/api/briefs/today',
        respond: () =>
          jsonOk({
            data: {
              ...BRIEF,
              noiseSenders: BRIEF.noiseSenders.map((s) => ({ ...s, isProtected: true })),
            },
          }),
      },
    ]);
    renderScreen();

    await waitFor(() => expect(archiveButton()).toBeDisabled());
    expect(archiveButton()).toHaveAccessibleName('Archive 0 senders');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
