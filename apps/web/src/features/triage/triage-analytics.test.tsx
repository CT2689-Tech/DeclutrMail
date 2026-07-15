/**
 * D159 core-loop funnel events — triage surface.
 *
 * Pins the analytics contract for the daily ritual:
 *
 *   - `page_viewed { page: 'triage' }` fires ONCE on the route mount.
 *   - `triage_action_taken` fires ONCE per decision, ONLY on server
 *     acceptance (never on preview open, never on rejection), with the
 *     confirm surface (`sheet` / `inline`), the engine-match flag, and
 *     the server-requested message count.
 *   - `undo_clicked` fires ONCE per undo attempt (row button or Z)
 *     with the entry's kind + age — never the capability token.
 *
 * Mirrors the harness of `triage-screen.actions.test.tsx`: real
 * dispatch pipeline against the fetch stub; PostHog module mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  addFetchHandlers,
  installFetchStub,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './data';
import { resetTriageStore, useTriageStore } from './store';
import { TriageScreen } from './triage-screen';
import { TriageUndoTray } from './triage-undo-tray';
import TriagePage from '@/app/(app)/triage/page';

const h = vi.hoisted(() => ({
  track: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  captureFeatureException: vi.fn(),
}));

vi.mock('@/lib/posthog', () => ({ track: h.track }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: h.captureFeatureException }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
const authMe = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'user@example.com', workspaceId: 'workspace-1' },
  activeMailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  mailboxes: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'user@example.com',
      status: 'active',
      connectedAt: '2026-07-14T00:00:00.000Z',
      readiness: 'ready',
    },
  ],
  tier: 'pro',
  cleanupRemaining: null,
}));
vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'user@example.com',
  useAuth: () => ({ me: authMe }),
  useOptionalAuth: () => ({ me: authMe }),
}));

const GROUPON = TRIAGE_QUEUE[0]!; // verdict: archive
const LINKEDIN = TRIAGE_QUEUE[1]!; // verdict: unsubscribe, one_click

const ACTION_ID = '44444444-4444-4444-8444-444444444444';

const PREVIEW_BODY = {
  sender: {
    id: GROUPON.senderId,
    name: GROUPON.senderName,
    domain: GROUPON.senderDomain,
    lastSeenDays: 0,
    repliedCount: 0,
    monthly: 52,
  },
  counts: { all: 47, olderThan30d: 30, olderThan90d: 12, olderThan180d: 5, olderThan365d: 1 },
  recentSubjects: {
    all: [],
    olderThan30d: [],
    olderThan90d: [],
    olderThan180d: [],
    olderThan365d: [],
  },
  unsubAvailable: true,
  protected: false,
};

const enqueueOkHandler = {
  method: 'POST' as const,
  path: '/api/actions',
  respond: () =>
    jsonOk({
      data: {
        actionId: ACTION_ID,
        compositeId: ACTION_ID,
        secondaryId: null,
        status: 'queued',
        primaryCount: 47,
        secondaryCount: null,
      },
    }),
};

const statusDoneHandler = {
  method: 'GET' as const,
  path: `/api/actions/${ACTION_ID}`,
  respond: () =>
    jsonOk({
      data: {
        actionId: ACTION_ID,
        status: 'done',
        requestedCount: 47,
        affectedCount: 47,
        undoToken: '55555555-5555-4555-8555-555555555555',
        errorCode: null,
      },
    }),
};

const actionTakenCalls = () =>
  h.track.mock.calls.filter(([name]) => name === 'triage_action_taken');

function renderScreen(journey: 'daily' | 'first_relief' = 'daily') {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <TriageScreen
        journey={journey}
        state={{ kind: 'ready', rows: [GROUPON, LINKEDIN], stats: TRIAGE_SESSION_STATS }}
      />
    </QueryWrapper>,
  );
}

function expandRow(senderName: string) {
  fireEvent.click(screen.getByRole('button', { name: `${senderName} — expand triage detail` }));
}

async function confirmOpenSheet(verb: 'Archive' | 'Unsubscribe') {
  const dialog = await screen.findByRole('dialog');
  await screen.findByText(/emails currently match in Inbox/i);
  const confirm = within(dialog).getByRole('button', { name: new RegExp(`^${verb}`, 'i') });
  await waitFor(() => expect(confirm).not.toBeDisabled());
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
}

beforeEach(() => {
  resetTriageStore();
  h.track.mockClear();
  h.toast.mockClear();
  h.captureFeatureException.mockClear();
  installFetchStub([
    {
      method: 'GET',
      path: '/api/actions/preview',
      respond: () => jsonOk({ data: PREVIEW_BODY }),
    },
  ]);
});

afterEach(() => {
  resetFetchStub();
});

describe('triage_action_taken (D159)', () => {
  it('attributes preview and accepted decisions to the finite first-relief journey', async () => {
    addFetchHandlers([enqueueOkHandler, statusDoneHandler]);
    renderScreen('first_relief');

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText(/emails currently match in Inbox/i);

    expect(h.track).toHaveBeenCalledWith('action_preview_viewed', {
      journey: 'first_relief',
      verb: 'archive',
    });
    await confirmOpenSheet('Archive');
    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith('action_confirmed', {
        journey: 'first_relief',
        verb: 'archive',
      }),
    );
  });

  it('sheet-confirmed Archive fires EXACTLY once, on mutation success, with the full payload', async () => {
    addFetchHandlers([enqueueOkHandler, statusDoneHandler]);
    renderScreen();

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await screen.findByText(/emails currently match in Inbox/i);

    // Preview open alone fires nothing.
    expect(actionTakenCalls()).toHaveLength(0);

    await confirmOpenSheet('Archive');

    await waitFor(() => expect(actionTakenCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith('triage_action_taken', {
      verb: 'archive',
      sender_id: GROUPON.senderId,
      // GROUPON's engine verdict IS archive.
      matched_recommendation: true,
      // The server's real coverage count from the enqueue accept.
      requested_messages: 47,
      source: 'sheet',
    });

    // The status poll reaching `done` must not re-fire the event.
    await waitFor(() => expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'warn'));
    expect(actionTakenCalls()).toHaveLength(1);
  });

  it('inline-confirmed Archive (sheet skipped, D34) records source inline', async () => {
    addFetchHandlers([enqueueOkHandler, statusDoneHandler]);
    useTriageStore.getState().setRememberPreference('Archive', true);
    renderScreen();

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText('Preview · before anything changes');
    await screen.findByText(/emails currently match in Inbox/i);
    expect(actionTakenCalls()).toHaveLength(0);

    // Second press of the same verb confirms the inline preview.
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => expect(actionTakenCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith(
      'triage_action_taken',
      expect.objectContaining({ verb: 'archive', source: 'inline' }),
    );
  });

  it('Keep fires with verb keep, zero affected messages, and the engine-match flag', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: () =>
          jsonOk({
            data: {
              senderId: GROUPON.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '66666666-6666-4666-8666-666666666666',
            },
          }),
      },
    ]);
    renderScreen();

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'k' });

    await waitFor(() => expect(actionTakenCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith('triage_action_taken', {
      verb: 'keep',
      sender_id: GROUPON.senderId,
      // The engine said archive; the user kept — no match.
      matched_recommendation: false,
      requested_messages: 0,
      source: 'inline',
    });
  });

  it('Unsubscribe + backlog archive = ONE decision, ONE event (verb unsubscribe)', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-intent',
        respond: () =>
          jsonOk({
            data: {
              senderId: LINKEDIN.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '77777777-7777-4777-8777-777777777777',
              method: 'none',
              executionActionId: null,
              mailtoUrl: null,
            },
          }),
      },
      enqueueOkHandler,
      statusDoneHandler,
    ]);
    renderScreen();

    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'u' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    // Backlog is a separate Gmail mutation, so opt in explicitly.
    fireEvent.click(screen.getByRole('button', { name: /Also archive the/i }));
    await confirmOpenSheet('Unsubscribe');

    await waitFor(() => expect(actionTakenCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith('triage_action_taken', {
      verb: 'unsubscribe',
      sender_id: LINKEDIN.senderId,
      matched_recommendation: true,
      requested_messages: 0,
      source: 'sheet',
    });
    // Let the backlog enqueue + poll settle — still one event.
    await waitFor(() => expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'warn'));
    expect(actionTakenCalls()).toHaveLength(1);
  });

  it('a FAILED mutation fires NO event (never optimistic)', async () => {
    addFetchHandlers([
      { method: 'POST', path: '/api/actions', respond: () => jsonServerError('boom') },
    ]);
    renderScreen();

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await confirmOpenSheet('Archive');

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Couldn't start archive ${GROUPON.senderName}. Nothing changed. The request was not accepted, so Gmail was not changed. Try again.`,
        'warn',
      ),
    );
    expect(actionTakenCalls()).toHaveLength(0);
  });
});

describe('undo_clicked (D159)', () => {
  const ENTRY_NEWEST = {
    token: '11111111-1111-4111-8111-111111111111',
    actionKind: 'archive' as const,
    createdAt: '2026-06-09T10:01:00.000Z',
    expiresAt: '2026-06-16T10:01:00.000Z',
  };
  const ENTRY_OLDER = {
    token: '22222222-2222-4222-8222-222222222222',
    actionKind: 'later' as const,
    createdAt: '2026-06-09T10:00:00.000Z',
    expiresAt: '2026-06-16T10:00:00.000Z',
  };

  const undoClickedCalls = () => h.track.mock.calls.filter(([name]) => name === 'undo_clicked');

  function stubTrayLoop() {
    const reverted = new Set<string>();
    addFetchHandlers([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: [ENTRY_NEWEST, ENTRY_OLDER].filter((e) => !reverted.has(e.token)),
            meta: { nextCursor: null, limit: 50 },
          }),
      },
      {
        method: 'POST',
        path: /\/api\/undo\/.+/,
        respond: (_req, url) => {
          const token = url.pathname.split('/').pop()!;
          reverted.add(token);
          return jsonOk({
            data: {
              token,
              actionKind: 'archive',
              reverted: false,
              expired: false,
              revertedAt: null,
              actionId: '33333333-3333-4333-8333-333333333333',
            },
          });
        },
      },
      {
        method: 'GET',
        path: /\/api\/actions\/.+/,
        respond: () =>
          jsonOk({
            data: {
              actionId: '33333333-3333-4333-8333-333333333333',
              status: 'done',
              requestedCount: 2,
              affectedCount: 2,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);
  }

  function renderTray() {
    const client = createTestQueryClient();
    return render(
      <QueryWrapper client={client}>
        <TriageUndoTray />
      </QueryWrapper>,
    );
  }

  it('a per-row Undo click fires EXACTLY once with the entry kind + age — never the token', async () => {
    stubTrayLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'Undo Later' }));

    await waitFor(() => expect(undoClickedCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith('undo_clicked', {
      verb: 'later',
      age_ms: expect.any(Number),
    });
    const [, payload] = undoClickedCalls()[0]! as [string, { age_ms: number }];
    expect(payload.age_ms).toBeGreaterThan(0);

    // The revert confirming (poll → done → refetch) must not re-fire.
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(1));
    expect(undoClickedCalls()).toHaveLength(1);
  });

  it('Z (undo last) fires once for the NEWEST entry', async () => {
    stubTrayLoop();
    renderTray();
    await waitFor(() => expect(screen.getAllByText('Undo')).toHaveLength(2));

    fireEvent.keyDown(window, { key: 'z' });

    await waitFor(() => expect(undoClickedCalls()).toHaveLength(1));
    expect(h.track).toHaveBeenCalledWith(
      'undo_clicked',
      expect.objectContaining({ verb: 'archive' }),
    );
  });
});

describe('page_viewed (D159)', () => {
  it('the triage route mount fires page_viewed { page: triage } exactly once', async () => {
    const undoTraySpy = vi.fn(() => jsonOk({ data: [], meta: { nextCursor: null, limit: 50 } }));
    addFetchHandlers([
      { method: 'GET', path: '/api/triage/queue', respond: () => jsonOk({ data: [] }) },
      {
        method: 'GET',
        path: '/api/triage/stats',
        respond: () => jsonOk({ data: TRIAGE_SESSION_STATS }),
      },
      {
        method: 'GET',
        path: '/api/undo',
        respond: undoTraySpy,
      },
    ]);
    const client = createTestQueryClient();
    render(
      <QueryWrapper client={client}>
        <TriagePage />
      </QueryWrapper>,
    );

    await waitFor(() =>
      expect(h.track).toHaveBeenCalledWith('page_viewed', {
        page: 'triage',
        mailbox_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
    expect(h.track.mock.calls.filter(([name]) => name === 'page_viewed')).toHaveLength(1);
    // The route no longer owns the persistent tray; AppChrome mounts it
    // once so rendering Triage inside the shell cannot double-fetch.
    expect(undoTraySpy).not.toHaveBeenCalled();
  });
});
