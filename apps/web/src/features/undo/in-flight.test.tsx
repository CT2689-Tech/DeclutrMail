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
  total: 13,
  done: 3,
  failed: 1,
  senderCount: 13,
  leadSenderName: 'Yankee Candle',
  startedAt: '2026-09-20T10:00:00.000Z',
};

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
    [status({ affectedCount: 1400 }), 'info', 'Delete: some email not changed'],
    [null, 'attention', 'Delete not confirmed'],
  ] as const)('%#: %s → %s', (result, tone, label) => {
    expect(outcomeNotice(GROUP, result)).toMatchObject({ tone, label });
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

  it('shows a decision already running when the page loads — nothing local knows about it', async () => {
    mount();
    const pill = await screen.findByRole('region', { name: 'Recent actions' });
    await waitFor(() => expect(pill).toHaveTextContent('Deleting… · 4 of 13'));
  });

  it('drops the line when it worked, and re-reads what can be undone', async () => {
    const { reread } = mount();
    await screen.findByText(/Deleting…/);
    const before = undoReads;
    active = [];
    await reread();
    await waitFor(() => expect(screen.queryByText(/Deleting…/)).toBeNull());
    await waitFor(() => expect(undoReads).toBeGreaterThan(before));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when part of it failed, until dismissed', async () => {
    batch = status({ done: 11, failed: 2 });
    const { reread } = mount();
    await screen.findByText(/Deleting…/);
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
    await screen.findByText(/Deleting…/);
    active = 'error';
    await reread();
    await waitFor(() =>
      expect(client.getQueryState(undoKeys.inFlight(undefined))?.status).toBe('error'),
    );
    // The line stays: an unreadable list is not a finished job.
    expect(screen.getByText(/Deleting…/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never reads another mailbox’s empty list as "everything stopped"', async () => {
    batch = status({ status: 'failed', done: 0, failed: 13 });
    const view = mount('mailbox-a');
    await screen.findByText(/Deleting…/);
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
