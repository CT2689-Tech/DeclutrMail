/**
 * The pill's live line: decisions still running come from the SERVER
 * (`GET /api/actions/active`), so they survive navigation and reload, and
 * a decision that stops without leaving something to undo says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { ProductUndoTray } from '@/features/triage/triage-undo-tray';
import { resetTriageStore } from '@/features/triage/store';
import type { BatchStatusResult, InFlightActionGroup } from '@/lib/api/actions';

import { outcomeNotice, workingNotice } from './in-flight';
import { undoKeys } from './query-keys';
import { ME_QUERY_KEY } from '@/features/auth/api/me-contract';

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: vi.fn() };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/senders',
}));

const GROUP: InFlightActionGroup = {
  groupId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  verb: 'delete',
  mixedVerbs: false,
  running: true,
  total: 13,
  done: 3,
  failed: 1,
  senderCount: 13,
  leadSenderName: 'Yankee Candle',
  startedAt: '2026-09-20T10:00:00.000Z',
};

/** `n` distinct sender ids, as the batch status lists skipped senders. */
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `sender-${i}`);

const status = (over: Partial<BatchStatusResult>): BatchStatusResult => ({
  batchId: GROUP.groupId,
  status: 'done',
  total: 13,
  done: 13,
  failed: 0,
  requestedCount: 1489,
  affectedCount: 1489,
  undoToken: null,
  unsubscribeOutcomes: null,
  ...over,
});

describe('what the pill says about a running decision', () => {
  it('names the verb, who, and how far along a bulk is', () => {
    expect(workingNotice(GROUP)).toMatchObject({
      tone: 'working',
      label: 'Deleting…',
      who: 'Yankee Candle + 12 others',
      detail: '4 of 13',
    });
  });

  it('gives a single-sender job no fraction to watch', () => {
    const one = workingNotice({ ...GROUP, total: 1, done: 0, failed: 0, senderCount: 1 });
    expect(one).toMatchObject({ label: 'Deleting…', who: 'Yankee Candle', detail: null });
  });

  it('counts senders when none of them resolves to a name', () => {
    expect(workingNotice({ ...GROUP, leadSenderName: null }).who).toBe('13 senders');
  });
});

describe('what the pill says once a decision stops', () => {
  it('says nothing when it worked — the undoable decision is the line', () => {
    expect(outcomeNotice(GROUP, status({}))).toBeNull();
  });

  it.each([
    [
      status({ status: 'failed', done: 0, failed: 13, affectedCount: 0 }),
      'attention',
      'Delete failed',
    ],
    [status({ done: 11, failed: 2 }), 'attention', 'Delete: 2 of 13 failed'],
    [status({ affectedCount: 0 }), 'info', 'Nothing to delete'],
    [null, 'attention', 'Delete: unknown'],
    // D245: a sender protected after the click is skipped, like one
    // protected before it — never "nothing to delete", never a failure.
    // Skipped senders are left out of every count the batch reports.
    [
      status({
        total: 0,
        done: 0,
        requestedCount: 0,
        affectedCount: 0,
        skippedProtectedSenderIds: ids(13),
      }),
      'info',
      'Delete: 13 Protected senders skipped',
    ],
    // The rest ran and changed nothing: both facts, not just the skip.
    [
      status({
        total: 12,
        done: 12,
        requestedCount: 9,
        affectedCount: 0,
        skippedProtectedSenderIds: ids(1),
      }),
      'info',
      'Delete: 1 Protected sender skipped · nothing else changed',
    ],
    // Beside a failure the skip is part of the line itself — an alert's
    // detail slot is not read aloud. The split counts jobs (a composite
    // runs two per sender), so beside a count of senders it names none.
    [
      status({ total: 12, done: 10, failed: 2, skippedProtectedSenderIds: ids(1) }),
      'attention',
      'Delete partly failed · 1 Protected sender skipped',
    ],
    [
      status({
        status: 'failed',
        total: 12,
        done: 0,
        failed: 12,
        affectedCount: 0,
        skippedProtectedSenderIds: ids(1),
      }),
      'attention',
      'Delete failed · 1 Protected sender skipped',
    ],
  ] as const)('%#: %s → %s', (result, tone, label) => {
    expect(outcomeNotice(GROUP, result)).toMatchObject({ tone, label });
  });

  // "Later" is the verb's name, not an English verb: "Nothing to later".
  it('says nothing moved to Later in words, not "nothing to later"', () => {
    expect(outcomeNotice({ ...GROUP, verb: 'later' }, status({ affectedCount: 0 }))).toMatchObject({
      tone: 'info',
      label: 'Nothing to move to Later',
    });
  });

  // Fewer moved than the preview counted means mail had already left the
  // inbox, not that some was left behind; the decision's own line has the
  // real number, and a notice here would sit above its Undo for 10s.
  it('says nothing when fewer moved than were counted', () => {
    expect(outcomeNotice(GROUP, status({ affectedCount: 1400 }))).toBeNull();
  });

  // A one-sender job that was skipped has no job left to count: 0 of 0 is
  // not "every one failed".
  it('says a one-sender skip was skipped, never that it failed', () => {
    const one = { ...GROUP, total: 1, done: 1, failed: 0, senderCount: 1 };
    expect(
      outcomeNotice(
        one,
        status({
          total: 0,
          done: 0,
          requestedCount: 0,
          affectedCount: 0,
          skippedProtectedSenderIds: ids(1),
        }),
      ),
    ).toMatchObject({
      tone: 'info',
      label: 'Delete: 1 Protected sender skipped',
      who: 'Yankee Candle',
    });
  });

  it('names who only when every sender was skipped as Protected', () => {
    expect(
      outcomeNotice(
        GROUP,
        status({
          total: 0,
          done: 0,
          requestedCount: 0,
          affectedCount: 0,
          skippedProtectedSenderIds: ids(13),
        }),
      )?.who,
    ).toBe('Yankee Candle + 12 others');
    expect(
      outcomeNotice(
        GROUP,
        status({
          total: 12,
          done: 12,
          requestedCount: 9,
          affectedCount: 0,
          skippedProtectedSenderIds: ids(1),
        }),
      )?.who,
    ).toBeUndefined();
  });

  // Founder decision D4: when the rest of the decision changed mail, the
  // skip rides that decision's own Undo line (from `GET /api/undo`), so
  // there is no second line here.
  it('adds no line of its own when the rest of the decision changed mail', () => {
    const rest = status({
      total: 12,
      done: 12,
      requestedCount: 1400,
      affectedCount: 1400,
      skippedProtectedSenderIds: ids(1),
    });
    expect(outcomeNotice(GROUP, rest)).toBeNull();
  });

  it('names no one on a failure line that also carries a skip', () => {
    const partly = status({ total: 12, done: 10, failed: 2, skippedProtectedSenderIds: ids(1) });
    expect(outcomeNotice(GROUP, partly)?.who).toBeUndefined();
    const failed = status({
      status: 'failed',
      total: 12,
      done: 0,
      failed: 12,
      affectedCount: 0,
      skippedProtectedSenderIds: ids(1),
    });
    expect(outcomeNotice(GROUP, failed)?.who).toBeUndefined();
    expect(outcomeNotice(GROUP, failed)?.detail).toBeUndefined();
  });

  it('claims no ending for a job that only aged out of the list', () => {
    expect(outcomeNotice(GROUP, status({ status: 'executing', done: 3 }))).toBeNull();
  });

  it('leaves an unsubscribe to its own receipt — a failed JOB can mean "sent, unconfirmed"', () => {
    expect(
      outcomeNotice({ ...GROUP, verb: 'unsubscribe' }, status({ status: 'failed', failed: 13 })),
    ).toBeNull();
  });
});

describe('ProductUndoTray — live line', () => {
  let active: InFlightActionGroup[] | 'error';
  let batch: BatchStatusResult | 'error';
  let undoReads: number;

  beforeEach(() => {
    resetTriageStore();
    active = [GROUP];
    batch = status({});
    undoReads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () => {
          undoReads += 1;
          return jsonOk({ data: [] });
        },
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => (active === 'error' ? jsonServerError() : jsonOk({ data: active })),
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/batch\/[^/]+$/,
        respond: () => (batch === 'error' ? jsonServerError() : jsonOk({ data: batch })),
      },
    ]);
  });
  afterEach(() => resetFetchStub());

  /** The visible pill's words (the screen-reader region repeats them, by design). */
  const pillText = () => document.querySelector('[data-dm-undo-tray]')?.textContent ?? '';

  function mount(mailboxId?: string) {
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <ProductUndoTray mailboxId={mailboxId} />
      </QueryWrapper>,
    );
    const reread = () =>
      act(async () => {
        await client.invalidateQueries({ queryKey: undoKeys.inFlight(mailboxId) });
      });
    return { ...view, client, reread };
  }

  it('says it to a screen reader from a region that existed BEFORE the first message', async () => {
    active = [];
    const { reread, client } = mount();
    await waitFor(() => expect(client.getQueryData(undoKeys.inFlight(undefined))).toEqual([]));
    const speech = document.querySelector('[data-dm-undo-tray-speech]')!;
    expect(speech).toHaveAttribute('role', 'status');
    expect(speech).toBeEmptyDOMElement();
    active = [GROUP];
    await reread();
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    expect(document.querySelector('[data-dm-undo-tray-speech]')).toBe(speech);
    expect(speech).toHaveTextContent('Deleting… Yankee Candle + 12 others');
    // The ticking fraction is for eyes only.
    expect(speech).not.toHaveTextContent('4 of 13');
  });

  it('shows a decision already running when the page loads — nothing local knows about it', async () => {
    mount();
    const pill = await screen.findByRole('region', { name: 'Recent actions' });
    await waitFor(() => expect(pill).toHaveTextContent('Deleting… · 4 of 13'));
  });

  it('drops the line when it worked, and re-reads what can be undone', async () => {
    const { reread } = mount();
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    const before = undoReads;
    active = [];
    await reread();
    await waitFor(() => expect(pillText()).not.toMatch(/Deleting…/));
    await waitFor(() => expect(undoReads).toBeGreaterThan(before));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // A run-time skip gives a Free cleanup unit back, and a start we could
  // not confirm may have spent one; `me` is otherwise read again only on
  // an enqueue that succeeded (flow-completeness audit 2026-09-27).
  it('re-reads the cleanup allowance when a decision stops', async () => {
    const { reread, client } = mount();
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    active = [];
    await reread();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_QUERY_KEY }));
  });

  it('says so when part of it failed, until dismissed', async () => {
    batch = status({ done: 11, failed: 2 });
    const { reread } = mount();
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    active = [];
    await reread();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Delete: 2 of 13 failed');
    act(() => screen.getByRole('button', { name: /^Dismiss/ }).click());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports nothing as ended when the list itself could not be read', async () => {
    batch = status({ status: 'failed', done: 0, failed: 13 });
    const { reread, client } = mount();
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    active = 'error';
    await reread();
    await waitFor(() =>
      expect(client.getQueryState(undoKeys.inFlight(undefined))?.status).toBe('error'),
    );
    // Not ended — and not spinning as if it were live either: the line says
    // it is the last thing we knew. (It used to freeze on "Deleting…".)
    await waitFor(() => expect(pillText()).toMatch(/Delete: unknown/));
    expect(pillText()).not.toMatch(/Deleting…/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a job it never saw running — quicker than a poll, or ended while away', async () => {
    batch = status({ done: 11, failed: 2 });
    active = [{ ...GROUP, running: false, done: 11, failed: 2 }];
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete: 2 of 13 failed');
    expect(pillText()).not.toMatch(/Deleting…/);
  });

  it('keeps the Undo earned this session through the per-screen baseline', async () => {
    // The decision is ALREADY in the undo list when this screen mounts
    // (acted on /senders, then opened a sender) — history by the baseline's
    // rule, except that this session just saw it in flight.
    resetFetchStub();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: [
              {
                groupId: GROUP.groupId,
                token: '11111111-1111-4111-8111-111111111111',
                actionKind: 'delete',
                createdAt: '2026-09-20T10:00:05.000Z',
                expiresAt: '2026-09-25T10:00:05.000Z',
                senderCount: 13,
                affectedCount: 1489,
              },
            ],
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: [{ ...GROUP, running: false, done: 13, failed: 0 }] }),
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/batch\/[^/]+$/,
        respond: () => jsonOk({ data: status({}) }),
      },
    ]);
    mount();
    const pill = await screen.findByRole('region', { name: 'Recent actions' });
    await waitFor(() => expect(pill).toHaveTextContent('Deleted 1,489 emails'));
    expect(screen.getByRole('button', { name: /^Undo Delete/ })).toBeInTheDocument();
  });

  // The count comes with the decision itself (`GET /api/undo`), in the
  // same read as the line: it never grows a moment after it renders, and
  // survives a mailbox round trip. The batch status here names no skip.
  it('folds a Protected skip into the decision’s own Undo line (D4)', async () => {
    resetFetchStub();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/undo',
        respond: () =>
          jsonOk({
            data: [
              {
                groupId: GROUP.groupId,
                token: '11111111-1111-4111-8111-111111111111',
                actionKind: 'delete',
                createdAt: '2026-09-20T10:00:05.000Z',
                expiresAt: '2026-09-25T10:00:05.000Z',
                senderCount: 12,
                affectedCount: 1400,
                protectedSkippedCount: 1,
              },
            ],
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/active',
        respond: () => jsonOk({ data: [{ ...GROUP, running: false, done: 13, failed: 0 }] }),
      },
      {
        method: 'GET',
        path: /^\/api\/actions\/batch\/[^/]+$/,
        respond: () =>
          jsonOk({
            data: status({ total: 12, done: 12, requestedCount: 1400, affectedCount: 1400 }),
          }),
      },
    ]);
    mount();
    const pill = await screen.findByRole('region', { name: 'Recent actions' });
    await waitFor(() =>
      expect(pill).toHaveTextContent(
        'Deleted 1,400 emails · 12 senders · 1 Protected sender skipped',
      ),
    );
    expect(screen.getByRole('button', { name: /^Undo Delete/ })).toHaveTextContent('Undo all');
    expect(pillText()).not.toMatch(/Delete: 1 Protected/);
  });

  it('says a one-sender job skipped as Protected was skipped, never that it failed', async () => {
    active = [{ ...GROUP, running: false, total: 1, done: 1, failed: 0, senderCount: 1 }];
    batch = status({
      total: 0,
      done: 0,
      requestedCount: 0,
      affectedCount: 0,
      skippedProtectedSenderIds: ids(1),
    });
    mount();
    const pill = await screen.findByRole('region', { name: 'Recent actions' });
    await waitFor(() =>
      expect(pill).toHaveTextContent('Delete: 1 Protected sender skipped · Yankee Candle'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never reads another mailbox’s empty list as "everything stopped"', async () => {
    batch = status({ status: 'failed', done: 0, failed: 13 });
    const view = mount('mailbox-a');
    await waitFor(() => expect(pillText()).toMatch(/Deleting…/));
    active = [];
    view.rerender(
      <QueryWrapper client={view.client}>
        <ProductUndoTray mailboxId="mailbox-b" />
      </QueryWrapper>,
    );
    await waitFor(() =>
      expect(view.client.getQueryData(undoKeys.inFlight('mailbox-b'))).toEqual([]),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
