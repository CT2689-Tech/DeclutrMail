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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { ToastHost } from '@declutrmail/shared';

import {
  installFetchStub,
  jsonOk,
  jsonServerError,
  resetFetchStub,
  type FetchStubHandler,
} from '@/test/fetch-stub';
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

/** A guard 409 — the shape `CurrentMailboxGuard` answers with. */
function jsonConflict(code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status: 409,
    headers: { 'content-type': 'application/json' },
  });
}

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

/**
 * `GET /api/actions/:id` — the undo-truth read the section derives its
 * Done marks and receipt from. `reverted` flips `undoRevertedAt`, which is
 * exactly what an undo taken in the global tray produces.
 */
function batchStatusHandler(
  opts: { done?: number; failed?: number; status?: string } = {},
): FetchStubHandler {
  return {
    method: 'GET',
    path: /^\/api\/actions\/batch\//,
    respond: () =>
      jsonOk({
        data: {
          batchId: 'batch-1',
          status: opts.status ?? 'done',
          total: 2,
          done: opts.done ?? 2,
          failed: opts.failed ?? 0,
          requestedCount: 351,
          affectedCount: 348,
          undoToken: 'undo-token-1',
        },
      }),
  };
}

function undoStateHandler(opts: { reverted?: boolean; expired?: boolean } = {}) {
  return {
    method: 'GET' as const,
    path: /^\/api\/actions\/[^/]+$/,
    respond: () =>
      jsonOk({
        data: {
          actionId: 'batch-1',
          verb: 'archive',
          direction: 'forward',
          status: 'done',
          requestedCount: 351,
          affectedCount: 348,
          wakeAt: null,
          undoToken: 'undo-token-1',
          undoExpiresAt: opts.expired
            ? new Date(Date.now() - 1_000).toISOString()
            : new Date(Date.now() + 86_400_000).toISOString(),
          undoExecutedAt: null,
          undoRevertedAt: opts.reverted ? new Date().toISOString() : null,
          errorCode: null,
        },
      }),
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
      {/* Skip warnings are toasts; without the host they never render. */}
      <ToastHost />
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

  it('blocks confirm when nothing from those senders is in the inbox', async () => {
    // The Brief counted 7 messages yesterday; the inbox holds none of
    // them now (already archived, or acted on elsewhere). Confirming
    // would enqueue a job that moves nothing and still spend a cleanup
    // unit, so the zero has to disarm the button it sits above.
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(() =>
        jsonOk({
          data: {
            ...BULK_PREVIEW,
            senders: BULK_PREVIEW.senders.map((s) => ({ ...s, counts: { ...s.counts, all: 0 } })),
            totals: { ...BULK_PREVIEW.totals, all: 0 },
          },
        }),
      ),
      enqueueHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    await within(dialog).findByText(/nothing to archive/i);
    // The headline and every per-sender row all read 0.
    expect(within(dialog).getAllByText('0').length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: /^Archive/ })).toBeDisabled();
    expect(enqueued).toHaveLength(0);
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

  it('marks the acted rows Done and reports the real affected count (D69)', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(),
      enqueueHandler(),
      batchStatusHandler(),
      undoStateHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    // The receipt states the WORKER's number (348), never the preview's
    // ask (351) and never yesterday's frozen count (7).
    await screen.findByText(/Archived 348 emails from 2 senders/i, undefined, { timeout: 5000 });
    // The undo sentence appears only once the undo-state read resolves —
    // until then the receipt deliberately says nothing about undo.
    await screen.findByText(/Undo it from Recent actions/i);

    // D69 — the acted rows are marked Done, and their frozen counts are
    // still yesterday's.
    expect(screen.getByText(/4 messages yesterday · Archived ✓/i)).toBeInTheDocument();
    expect(screen.getByText(/3 messages yesterday · Archived ✓/i)).toBeInTheDocument();
    // The Protected row was never in the batch, so it is not marked Done.
    expect(screen.getByText(/2 messages yesterday · Protected/i)).toBeInTheDocument();
  });

  /**
   * The worst blocker the gates found: `Archived ✓` and the receipt were
   * plain component state, which no invalidation can reach, so a tray
   * undo left the Brief asserting an archive whose mail was already back
   * in the inbox. Both are now derived from a server read whose key sits
   * under `undoKeys`, so this test drives the exact invalidation the
   * global tray performs and requires the claim to disappear.
   */
  it('clears the Done marks and the receipt when the archive is undone', async () => {
    let reverted = false;
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(),
      enqueueHandler(),
      batchStatusHandler(),
      {
        method: 'GET',
        path: /^\/api\/actions\/[^/]+$/,
        respond: () => undoStateHandler({ reverted }).respond(),
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <BriefScreen />
      </QueryWrapper>,
    );

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await screen.findByText(/Archived 348 emails from 2 senders/i);
    expect(screen.getByText(/4 messages yesterday · Archived ✓/i)).toBeInTheDocument();

    // The undo lands, then the tray fires exactly this invalidation.
    reverted = true;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['undo'] });
    });

    await waitFor(() => expect(screen.queryByText(/Archived 348 emails/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/Archived ✓/i)).not.toBeInTheDocument();
    await screen.findByText(/That archive was undone/i);
    // The senders are selectable again, so a fresh archive is possible.
    expect(
      screen.getByRole('checkbox', { name: /include newsletter daily in the archive/i }),
    ).toBeInTheDocument();
  });

  it('stops promising undo once the window has expired (D211)', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(),
      enqueueHandler(),
      batchStatusHandler(),
      undoStateHandler({ expired: true }),
    ]);
    renderScreen();

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await screen.findByText(/The undo window for this archive has passed/i);
    expect(screen.queryByText(/Undo it from Recent actions/i)).not.toBeInTheDocument();
  });

  it('leaves a persistent line on partial failure and disarms the succeeded senders', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(),
      enqueueHandler(),
      batchStatusHandler({ done: 1, failed: 1 }),
      undoStateHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    // A toast vanishes in 3.6s; the bar must still say what happened.
    await screen.findByText(/1 of 2 senders were archived; 1 did not complete/i);
    // And must not re-arm the sender that already archived.
    await waitFor(() => expect(archiveButton()).toBeDisabled());
    expect(archiveButton()).toHaveAccessibleName('Archive 0 senders');
  });

  it('surfaces a not_found skip instead of dropping the sender silently', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(),
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req: Request) => {
          enqueued.push((await req.json()) as Record<string, unknown>);
          return jsonOk({
            data: {
              batchId: 'batch-1',
              status: 'queued',
              senderCount: 1,
              requestedTotal: 210,
              wakeAt: null,
              skipped: [{ senderId: ID_SHOP, reason: 'not_found' }],
            },
          });
        },
      },
      batchStatusHandler({ done: 1 }),
      undoStateHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    const confirm = await within(dialog).findByRole('button', { name: /^Archive/ });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);

    await screen.findByText(/1 no longer in this mailbox — left out of this archive/i);
  });

  it('renders the scope-conflict state instead of a Retry that would 409 forever', async () => {
    installFetchStub([
      briefHandler(),
      bulkPreviewHandler(() => jsonConflict('SELECT_MAILBOX')),
      enqueueHandler(),
    ]);
    renderScreen();

    const dialog = await openPreview();
    await within(dialog).findByText(/Your active mailbox changed while this was open/i);
    expect(within(dialog).getByRole('button', { name: /^Archive/ })).toBeDisabled();
    expect(
      within(dialog).queryByRole('button', { name: /retry preview/i }),
    ).not.toBeInTheDocument();
    expect(enqueued).toHaveLength(0);
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
