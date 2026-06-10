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
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS } from './data';
import { resetTriageStore } from './store';
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
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['undo', 'tray'] });
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
    addFetchHandlers([
      {
        method: 'POST',
        path: '/api/actions/unsubscribe-intent',
        respond: () => {
          calls.push('unsub-intent');
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
    // The backlog toggle defaults ON for Unsubscribe; ⌘⏎ confirms.
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });

    // Intent first, then the archive enqueue (the toggle's promise is
    // kept via the real pipeline, not a tracer).
    await waitFor(() => expect(calls).toEqual(['unsub-intent', 'composite-archive']));
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
