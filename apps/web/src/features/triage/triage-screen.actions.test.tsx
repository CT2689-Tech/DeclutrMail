/**
 * TriageScreen mutation-wiring integration tests (D226, D29/D227, D40).
 *
 * Exercises the real dispatch pipeline against the fetch stub:
 *
 *   - Archive: K/A/U/L shortcut → sheet → ⌘⏎ confirm → POST
 *     /api/actions (composite, Idempotency-Key) → status poll → cache
 *     invalidation on `done`. No optimistic removal: the row leaves
 *     the queue only via the refetch the invalidation triggers.
 *   - Keep: policy/verdict-only → POST /api/actions/keep-intent.
 *   - Unsubscribe: intent POST + the "also archive the backlog"
 *     toggle riding the real archive pipeline.
 *   - Busy state: the acted-on row renders aria-busy until the worker
 *     confirms.
 *   - Failure paths (the kill-the-worker class): terminal `failed`
 *     status, sustained poll error, Keep POST failure, the
 *     unsubscribe-then-archive partial failure, and the global
 *     single-in-flight re-entry guard. Each must warn-toast, release
 *     the busy latch, and leave the queue un-invalidated (except the
 *     partial-failure case, where the intent's success DID invalidate).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

import {
  addFetchHandlers,
  installFetchStub,
  jsonOk,
  jsonServerError,
  resetFetchStub,
} from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { undoKeys } from '@/features/undo/query-keys';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './data';
import { resetTriageStore, useTriageStore } from './store';
import { TriageScreen } from './triage-screen';

// Toast is the ONLY user-visible failure surface in this flow (D35 —
// decisions never success-toast), so failure tests must assert the
// exact message + tone. Partial mock: everything else from the shared
// package stays real (Button, tokens, the sheet's primitives, …).
const h = vi.hoisted(() => ({ toast: vi.fn(), captureFeatureException: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});
vi.mock('@/lib/sentry', () => ({
  captureFeatureException: h.captureFeatureException,
}));
// The app shell supplies the active mailbox in production. Keep this
// integration harness account-aware so Gmail handoffs exercise the same
// mailbox-bound URL contract instead of silently disappearing.
vi.mock('@/features/auth/auth-provider', () => ({
  getActiveMailboxEmail: () => 'owner@gmail.com',
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user: { email: 'owner@gmail.com' },
      mailboxes: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          email: 'owner@gmail.com',
        },
      ],
    },
  }),
}));

const GROUPON = TRIAGE_QUEUE[0]!; // archive verdict, unprotected
const LINKEDIN = TRIAGE_QUEUE[1]!; // unsubscribe verdict, one_click

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

const ACTION_ID = '44444444-4444-4444-8444-444444444444';

function renderScreen(client: QueryClient) {
  return render(
    <QueryWrapper client={client}>
      <TriageScreen
        state={{ kind: 'ready', rows: [GROUPON, LINKEDIN], stats: TRIAGE_SESSION_STATS }}
      />
    </QueryWrapper>,
  );
}

function expandRow(senderName: string) {
  fireEvent.click(screen.getByRole('button', { name: `${senderName} — expand triage detail` }));
}

/** Wait until the required current-match preview has unlocked confirm. */
async function waitForLivePreview() {
  await waitFor(() => expect(screen.getByText('47')).toBeDefined());
}

describe('TriageScreen — D226 mutation wiring', () => {
  beforeEach(() => {
    resetTriageStore();
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

  it('Archive: shortcut → sheet (real count) → ⌘⏎ → composite POST → poll → invalidate on done', async () => {
    const enqueues: Array<{ body: unknown; idempotencyKey: string | null }> = [];
    let statusCalls = 0;
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          enqueues.push({
            body: await req.json(),
            idempotencyKey: req.headers.get('idempotency-key'),
          });
          return jsonOk({
            data: {
              actionId: ACTION_ID,
              compositeId: ACTION_ID,
              secondaryId: null,
              status: 'queued',
              primaryCount: 47,
              secondaryCount: null,
            },
          });
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        respond: () => {
          statusCalls += 1;
          return jsonOk({
            data: {
              actionId: ACTION_ID,
              status: 'done',
              requestedCount: 47,
              affectedCount: 47,
              undoToken: '55555555-5555-4555-8555-555555555555',
              errorCode: null,
            },
          });
        },
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });

    // The sheet opens with the MANDATORY preview (D226) and the REAL
    // server-side count — never a lifetime estimate.
    await waitFor(() =>
      expect(
        screen.getByRole('region', { name: `Preview · Archive ${GROUPON.senderName}` }),
      ).toBeDefined(),
    );
    await waitFor(() => expect(screen.getByText('47')).toBeDefined());

    // ⌘⏎ confirms.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(enqueues).toHaveLength(1));
    expect(enqueues[0]!.body).toMatchObject({
      selector: { type: 'sender', senderId: GROUPON.senderId },
      primary: { type: 'archive', olderThanDays: null },
    });
    // One fresh Idempotency-Key per confirm (D202).
    expect(enqueues[0]!.idempotencyKey ?? '').toMatch(/[0-9a-f-]{8,}/);

    // Server confirmation: the poll reaches `done` and the queue/stats/
    // activity/undo caches are invalidated — the refetch (not an
    // optimistic splice) is what removes the row.
    await waitFor(() => expect(statusCalls).toBeGreaterThan(0));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'stats'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: undoKeys.all });
  });

  it('keeps the acted-on row busy (aria-busy) while the worker has not confirmed', async () => {
    addFetchHandlers([
      {
        method: 'POST',
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
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        // Never terminal — the decision stays in flight.
        respond: () =>
          jsonOk({
            data: {
              actionId: ACTION_ID,
              status: 'executing',
              requestedCount: 47,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The row renders busy until the server confirms; the queue is NOT
    // invalidated while in flight (no optimistic removal — D226).
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
  });

  it('Keep dispatches immediately to POST /api/actions/keep-intent (no sheet, D40)', async () => {
    const keeps: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: async (req) => {
          keeps.push(await req.json());
          return jsonOk({
            data: {
              senderId: GROUPON.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '66666666-6666-4666-8666-666666666666',
            },
          });
        },
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'k' });

    await waitFor(() => expect(keeps).toEqual([{ senderId: GROUPON.senderId }]));
    // No sheet for Keep — the verdict applies immediately.
    expect(screen.queryByRole('dialog')).toBeNull();
    // Server-confirmed: the queue invalidation fires on the POST's 200.
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] }),
    );
  });

  it('Unsubscribe records the intent AND archives the backlog via the real pipeline', async () => {
    const calls: string[] = [];
    let unsubscribeBody: unknown = null;
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-intent',
        respond: async (req) => {
          calls.push('unsub-intent');
          unsubscribeBody = await req.json();
          return jsonOk({
            data: {
              senderId: LINKEDIN.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '77777777-7777-4777-8777-777777777777',
            },
          });
        },
      },
      {
        method: 'POST',
        path: '/api/actions',
        respond: () => {
          calls.push('composite-archive');
          return jsonOk({
            data: {
              actionId: ACTION_ID,
              compositeId: ACTION_ID,
              secondaryId: null,
              status: 'queued',
              primaryCount: 12,
              secondaryCount: null,
            },
          });
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        respond: () =>
          jsonOk({
            data: {
              actionId: ACTION_ID,
              status: 'done',
              requestedCount: 12,
              affectedCount: 12,
              undoToken: '88888888-8888-4888-8888-888888888888',
              errorCode: null,
            },
          }),
      },
    ]);

    const client = createTestQueryClient();
    renderScreen(client);

    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'u' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    // Backlog is a separate Gmail mutation, so opt in explicitly.
    fireEvent.click(screen.getByRole('button', { name: /Also archive the/i }));
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // Intent first, then the archive enqueue (the toggle's promise is
    // kept via the real pipeline, not a tracer).
    await waitFor(() => expect(calls).toEqual(['unsub-intent', 'composite-archive']));
    expect(unsubscribeBody).toEqual({
      senderId: LINKEDIN.senderId,
      includesBacklogAction: true,
    });
  });

  it('surfaces a designed 409 (protected sender) without crashing or invalidating', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions',
        respond: () =>
          new Response(
            JSON.stringify({
              error: { code: 'PROTECTED_SENDER', message: 'Protected.' },
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The failure leaves the queue untouched: no busy latch, no
    // invalidation, row still present.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
    expect(screen.getByText(GROUPON.senderName)).toBeDefined();
  });

  it('terminal FAILED: warn toast, busy latch releases, row stays, no invalidation', async () => {
    addFetchHandlers([
      {
        method: 'POST',
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
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        // The worker ran and the Gmail call failed — terminal `failed`.
        respond: () =>
          jsonOk({
            data: {
              actionId: ACTION_ID,
              status: 'failed',
              requestedCount: 47,
              affectedCount: 0,
              undoToken: null,
              errorCode: 'GMAIL_5XX',
            },
          }),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The failure is toasted (warn) — there is no other failure surface.
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Couldn't archive ${GROUPON.senderName} — see Activity`,
        'warn',
      ),
    );
    // The latch releases so the queue is usable again; the row STAYS
    // (no invalidation — nothing moved server-side).
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
    expect(screen.getByText(GROUPON.senderName)).toBeDefined();
    // No success toast ever (D35 — the tray is the feedback channel).
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('poll error (worker/API down mid-action): warn toast, latch releases, no invalidation', async () => {
    addFetchHandlers([
      {
        method: 'POST',
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
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        // Sustained poll failure — `useActionStatus` runs `retry: false`
        // so this surfaces as `isError` on the first poll.
        respond: () => jsonServerError('boom'),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Couldn't confirm ${GROUPON.senderName} — see Activity`,
        'warn',
      ),
    );
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
    expect(screen.getByText(GROUPON.senderName)).toBeDefined();
    expect(h.toast).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('Keep failure: warn toast, row un-busies, no invalidation', async () => {
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: () => jsonServerError('boom'),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'k' });

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Couldn't keep ${GROUPON.senderName} — try again`,
        'warn',
      ),
    );
    // `onSettled` releases the intent latch — the row is decidable again.
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
    expect(screen.getByText(GROUPON.senderName)).toBeDefined();
  });

  it('Unsubscribe partial failure: intent recorded (queue invalidated) but backlog archive warns', async () => {
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
            },
          }),
      },
      {
        // The backlog-archive enqueue fails AFTER the intent succeeded.
        method: 'POST',
        path: '/api/actions',
        respond: () => jsonServerError('boom'),
      },
    ]);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { container } = renderScreen(client);

    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'u' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /Also archive the/i }));
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // The partial-failure copy is explicit: the unsubscribe DID queue,
    // only the backlog archive did not (recoverable from Senders).
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Unsubscribe queued, but couldn't archive the backlog from ${LINKEDIN.senderName}`,
        'warn',
      ),
    );
    // The intent succeeded, so the queue WAS invalidated — the sender
    // leaves the queue via the refetch even though the archive failed.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] });
    // No archive latch lingers (the enqueue never returned an actionId).
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('re-entry guard: a 2nd decision while one confirms is deferred with an info toast', async () => {
    const keeps: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
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
      },
      {
        method: 'GET',
        path: `/api/actions/${ACTION_ID}`,
        // Never terminal — the first decision stays confirming.
        respond: () =>
          jsonOk({
            data: {
              actionId: ACTION_ID,
              status: 'executing',
              requestedCount: 47,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
      {
        method: 'POST',
        path: '/api/actions/keep-intent',
        respond: async (req) => {
          keeps.push(await req.json());
          return jsonOk({
            data: {
              senderId: LINKEDIN.senderId,
              recordedAt: new Date().toISOString(),
              activityLogId: '66666666-6666-4666-8666-666666666666',
            },
          });
        },
      },
    ]);

    const client = createTestQueryClient();
    const { container } = renderScreen(client);

    // First decision: Archive GROUPON — stays in flight.
    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    await waitForLivePreview();
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());

    // Second decision on a DIFFERENT row while the first confirms:
    // deferred with the quiet hint, and no second mutation fires.
    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'k' });

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        'Still confirming your last decision — give it a moment.',
        'info',
      ),
    );
    expect(keeps).toHaveLength(0);
  });
});

/**
 * D9 Wave 2 — the three unsubscribe method states + the honest
 * execution outcomes + D58's no-undo copy.
 */
describe('TriageScreen — unsubscribe execution states (D9, D58, D230)', () => {
  const EXEC_ID = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    resetTriageStore();
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

  /** Open the U sheet on LINKEDIN with the safe no-backlog default, then confirm. */
  async function confirmUnsubWithoutBacklog() {
    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'u' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
  }

  function intentHandler(data: Record<string, unknown>) {
    return {
      method: 'POST' as const,
      path: '/api/actions/unsubscribe-intent',
      respond: () =>
        jsonOk({
          data: {
            senderId: LINKEDIN.senderId,
            recordedAt: new Date().toISOString(),
            activityLogId: '77777777-7777-4777-8777-777777777777',
            ...data,
          },
        }),
    };
  }

  function execStatusHandler(status: 'done' | 'failed', errorCode: string | null) {
    return {
      method: 'GET' as const,
      path: `/api/actions/${EXEC_ID}`,
      respond: () =>
        jsonOk({
          data: {
            actionId: EXEC_ID,
            status,
            requestedCount: 1,
            affectedCount: status === 'done' ? 1 : 0,
            // D58 — a network unsub NEVER carries an undo token.
            undoToken: null,
            errorCode,
          },
        }),
    };
  }

  it("D58: the sheet says the unsubscribe itself can't be undone", async () => {
    const client = createTestQueryClient();
    renderScreen(client);
    expandRow(LINKEDIN.senderName);
    fireEvent.keyDown(window, { key: 'u' });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeDefined());
    expect(
      screen.getByText("The unsubscribe request can't be undone. Existing inbox mail stays put."),
    ).toBeDefined();
  });

  it('one_click → done: execution polled to done, queue refreshed, NO success toast (D35)', async () => {
    addFetchHandlers([
      intentHandler({ method: 'one_click', executionActionId: EXEC_ID, mailtoUrl: null }),
      execStatusHandler('done', null),
    ]);
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderScreen(client);

    await confirmUnsubWithoutBacklog();

    // The intent invalidates the queue (decision recorded)…
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] }),
    );
    // …and the execution settles silently (tray discipline — no
    // success toast, no warn toast). The done-handler re-invalidates
    // so /activity picks up the worker's outcome row.
    await waitFor(() => expect(invalidateSpy.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('one_click → target refused (4xx/5xx): honest warn toast suggesting Archive', async () => {
    addFetchHandlers([
      intentHandler({ method: 'one_click', executionActionId: EXEC_ID, mailtoUrl: null }),
      execStatusHandler('failed', 'UNSUB_TARGET_REJECTED'),
    ]);
    const client = createTestQueryClient();
    renderScreen(client);

    await confirmUnsubWithoutBacklog();

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `${LINKEDIN.senderName}'s list refused the unsubscribe — Archive is the reliable fallback`,
        'warn',
      ),
    );
  });

  it('one_click → 3xx redirect: ambiguous copy ("may have worked"), never a claimed success', async () => {
    addFetchHandlers([
      intentHandler({ method: 'one_click', executionActionId: EXEC_ID, mailtoUrl: null }),
      execStatusHandler('failed', 'UNSUB_AMBIGUOUS_REDIRECT'),
    ]);
    const client = createTestQueryClient();
    renderScreen(client);

    await confirmUnsubWithoutBacklog();

    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(
        `Couldn't confirm ${LINKEDIN.senderName}'s unsubscribe — it may have worked. Watch for new mail.`,
        'warn',
      ),
    );
  });

  it('mailto → manual callout with the PREFILLED Gmail compose link (D230 — the user sends)', async () => {
    addFetchHandlers([
      intentHandler({
        method: 'mailto',
        executionActionId: null,
        mailtoUrl: 'mailto:unsubscribe@linkedin.example?subject=Remove%20me',
      }),
    ]);
    const client = createTestQueryClient();
    renderScreen(client);

    await confirmUnsubWithoutBacklog();

    await waitFor(() => expect(screen.getByTestId('unsub-mailto-callout')).toBeDefined());
    const link = screen.getByRole('link', { name: 'Open Gmail compose' });
    expect(link.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?authuser=owner%40gmail.com&view=cm&fs=1&to=unsubscribe%40linkedin.example&su=Remove+me',
    );
    // Dismissible.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('unsub-mailto-callout')).toBeNull();
  });

  it('none → no execution, no callout: the decision records and nothing is promised', async () => {
    addFetchHandlers([intentHandler({ method: 'none', executionActionId: null, mailtoUrl: null })]);
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    renderScreen(client);

    await confirmUnsubWithoutBacklog();

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['triage', 'queue'] }),
    );
    expect(screen.queryByTestId('unsub-mailto-callout')).toBeNull();
    expect(h.toast).not.toHaveBeenCalled();
  });
});

/**
 * D226/D34 — the inline pending preview (sheet skipped via the
 * remember-preference path) must clear on Escape WITHOUT firing the
 * mutation. Pins the contract the inline-confirm comment promises;
 * the sheet surface owns its own Escape (action-sheet.test.tsx).
 */
describe('TriageScreen — inline pending preview clears on Escape (D226, D34)', () => {
  beforeEach(() => {
    resetTriageStore();
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

  it('Escape clears the inline pending action, keeps the row expanded, fires no mutation', async () => {
    const enqueues: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          enqueues.push(await req.json());
          return jsonOk({ data: { actionId: ACTION_ID, status: 'queued' } });
        },
      },
    ]);
    // Remember-preference ON for Archive → the verb goes inline, no sheet.
    useTriageStore.getState().setRememberPreference('Archive', true);

    const client = createTestQueryClient();
    renderScreen(client);
    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });

    // Inline preview banner renders (no dialog — the sheet was skipped).
    await screen.findByText('Preview · before anything changes');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useTriageStore.getState().pendingAction).toMatchObject({
      verb: 'Archive',
      rowId: GROUPON.id,
      surface: 'inline',
    });

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByText('Preview · before anything changes')).toBeNull());
    expect(useTriageStore.getState().pendingAction).toBeNull();
    // The row stays expanded — only the pending decision is discarded.
    expect(useTriageStore.getState().expandedRowId).toBe(GROUPON.id);
    // No mutation ever fired.
    expect(enqueues).toHaveLength(0);
  });

  it('Escape inside an input is ignored (typing convention)', async () => {
    useTriageStore.getState().setRememberPreference('Archive', true);
    const client = createTestQueryClient();
    renderScreen(client);
    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText('Preview · before anything changes');

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    // Pending action survives — Escape belonged to the input.
    expect(useTriageStore.getState().pendingAction).not.toBeNull();
    expect(screen.getByText('Preview · before anything changes')).toBeDefined();
    input.remove();
  });

  it('blocks second-click and shortcut confirmation when the inline preview is unavailable', async () => {
    const enqueues: unknown[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => jsonServerError('preview_down'),
      },
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          enqueues.push(await req.json());
          return jsonServerError('must_not_run');
        },
      },
    ]);
    useTriageStore.getState().setRememberPreference('Archive', true);
    renderScreen(createTestQueryClient());
    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });

    await screen.findByText(/Close and retry/i);
    const archive = screen.getByRole('button', { name: /Archive \(A\)/i });
    expect(archive).toBeDisabled();
    fireEvent.click(archive);
    fireEvent.keyDown(window, { key: 'a' });
    await Promise.resolve();

    expect(enqueues).toHaveLength(0);
    expect(useTriageStore.getState().pendingAction).not.toBeNull();
  });

  it('allows the second shortcut to confirm after the inline current-match preview resolves', async () => {
    const enqueues: unknown[] = [];
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions',
        respond: async (req) => {
          enqueues.push(await req.json());
          return jsonOk({
            data: {
              actionId: ACTION_ID,
              compositeId: ACTION_ID,
              secondaryId: null,
              status: 'queued',
              primaryCount: 47,
              secondaryCount: null,
            },
          });
        },
      },
    ]);
    useTriageStore.getState().setRememberPreference('Archive', true);
    renderScreen(createTestQueryClient());
    expandRow(GROUPON.senderName);
    fireEvent.keyDown(window, { key: 'a' });

    await screen.findByText(/emails currently match in Inbox/i);
    expect(screen.getByRole('button', { name: /Archive \(A\)/i })).toBeEnabled();
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => expect(enqueues).toHaveLength(1));
  });
});
