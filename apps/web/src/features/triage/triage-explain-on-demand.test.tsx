// Explanations on demand in the Triage queue (D24, founder decision
// 2026-09-25 — explain only what the user is about to see).
//
// The queue is what the user is about to read: every decision opens its
// reason (the sheet's "Why suggested", the expanded row, the card's "Why?").
// So the queue asks for the sentence behind every row still on the
// template — in onboarding too, because an explanation never moves a
// verdict, a confidence or an age, and so cannot shift the D112 practice
// set the way a re-score would.

import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { TRIAGE_BOOTSTRAP_KEY } from './api/query-options';
import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS, type TriageDecisionRow } from './data';
import { resetTriageStore, useTriageStore } from './store';
import { storeTriageMode } from './test-mode';
import { TriageScreen } from './triage-screen';

let explained: Array<{ senderIds: string[] }>;
let rescored: Array<Record<string, unknown>>;

function renderScreen(rows: TriageDecisionRow[], journey: 'daily' | 'first_relief' = 'daily') {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <TriageScreen
        state={{ kind: 'ready', rows, stats: TRIAGE_SESSION_STATS }}
        journey={journey}
      />
    </QueryWrapper>,
  );
}

/** The fixture queue with provenance on its first three rows. */
function queueWithProvenance(): TriageDecisionRow[] {
  const [a, b, c, ...rest] = TRIAGE_QUEUE;
  const read = { stale: false, scoredAt: '2026-09-25T08:30:00.000Z' };
  return [
    { ...a!, ...read, generatedBy: 'template' },
    { ...b!, ...read, generatedBy: 'llm_haiku' },
    { ...c!, ...read, generatedBy: 'template' },
    // The rest carry no provenance, like the demo fixtures: no claim.
    ...rest,
  ];
}

beforeEach(() => {
  resetTriageStore();
  explained = [];
  rescored = [];
  installFetchStub([
    {
      method: 'POST',
      path: '/api/triage/explain',
      respond: async (req: Request) => {
        const body = (await req.json()) as { senderIds: string[] };
        explained.push(body);
        return jsonOk({ data: { queued: body.senderIds } });
      },
    },
    {
      method: 'POST',
      path: '/api/triage/score-sender',
      respond: async (req: Request) => {
        rescored.push((await req.json()) as Record<string, unknown>);
        return jsonOk({ data: { idempotencyKey: 'k' } });
      },
    },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  resetFetchStub();
  resetTriageStore();
  vi.restoreAllMocks();
});

describe('Triage — explaining the queue on demand', () => {
  it('asks for the sentence behind every queue row still on the template', async () => {
    const rows = queueWithProvenance();
    renderScreen(rows);

    await waitFor(() => expect(explained).toHaveLength(1));
    expect([...explained[0]!.senderIds].sort()).toEqual(
      [rows[0]!.senderId, rows[2]!.senderId].sort(),
    );
    // An explanation is not a re-score.
    expect(rescored).toHaveLength(0);
  });

  it('asks during onboarding too — an explanation cannot shift the practice set', async () => {
    const rows = queueWithProvenance();
    renderScreen(rows, 'first_relief');

    await waitFor(() => expect(explained).toHaveLength(1));
    expect(rescored).toHaveLength(0);
  });

  it('asks nothing of a queue whose reasons are already written', async () => {
    const rows = queueWithProvenance().map((row) => ({
      ...row,
      generatedBy: 'llm_haiku' as const,
    }));
    renderScreen(rows);

    await new Promise((r) => setTimeout(r, 40));
    expect(explained).toHaveLength(0);
  });
});

/**
 * The queue asks for every sentence, but only the reason on screen is
 * worth a refetch: the queue re-reads after every decision anyway, and a
 * refetch per arriving row would spend the read budget the queue itself
 * needs.
 */
describe('Triage — picking up the sentence the user is reading', () => {
  beforeEach(() => storeTriageMode('list'));

  function renderWithSpy(rows: TriageDecisionRow[]) {
    const client = createTestQueryClient();
    const refetched = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryWrapper client={client}>
        <TriageScreen
          state={{ kind: 'ready', rows, stats: TRIAGE_SESSION_STATS }}
          journey="daily"
        />
      </QueryWrapper>,
    );
    const queueRefetches = () =>
      refetched.mock.calls.filter(
        ([filters]) =>
          JSON.stringify((filters as { queryKey?: unknown })?.queryKey) ===
          JSON.stringify(TRIAGE_BOOTSTRAP_KEY),
      ).length;
    return { queueRefetches };
  }

  it('never re-reads the queue for reasons nobody has opened', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { queueRefetches } = renderWithSpy(queueWithProvenance());
    await waitFor(() => expect(explained).toHaveLength(1));

    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(queueRefetches()).toBe(0);
  });

  it('re-reads the queue while the opened row is still on the template', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rows = queueWithProvenance();
    const { queueRefetches } = renderWithSpy(rows);
    await waitFor(() => expect(explained).toHaveLength(1));

    act(() => useTriageStore.getState().setExpandedRow(rows[0]!.id));
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(queueRefetches()).toBeGreaterThanOrEqual(1);
    // Opening it asks nothing new — the queue already asked.
    expect(explained).toHaveLength(1);
  });

  it('re-reads the queue while the action sheet shows a template reason', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const rows = queueWithProvenance();
    const { queueRefetches } = renderWithSpy(rows);
    await waitFor(() => expect(explained).toHaveLength(1));

    // The sheet's "Why suggested" row renders the reason.
    act(() => useTriageStore.getState().openPending('Archive', rows[2]!.id, 'sheet'));
    await act(() => vi.advanceTimersByTimeAsync(20_000));

    expect(queueRefetches()).toBeGreaterThanOrEqual(1);
  });
});

/**
 * A stale row is the stale refresh's to fix — but the stale refresh runs
 * only for the row the user EXPANDS in the daily ritual (founder decision
 * 2026-08-19) and never in onboarding (D112). Everywhere else a stale
 * template would never get a sentence, so there the page asks for one.
 */
describe('Triage — stale reasons nobody is re-scoring', () => {
  beforeEach(() => storeTriageMode('list'));

  function staleTemplateQueue(): TriageDecisionRow[] {
    const [a, b, ...rest] = TRIAGE_QUEUE;
    const stale = {
      stale: true,
      scoredAt: '2026-09-01T08:30:00.000Z',
      generatedBy: 'template' as const,
    };
    return [{ ...a!, ...stale }, { ...b!, ...stale }, ...rest];
  }

  it('does not ask for stale rows just for being in the queue', async () => {
    renderScreen(staleTemplateQueue());

    await new Promise((r) => setTimeout(r, 40));
    expect(explained).toHaveLength(0);
  });

  it('asks for a stale row the action sheet shows', async () => {
    const rows = staleTemplateQueue();
    renderScreen(rows);

    act(() => useTriageStore.getState().openPending('Archive', rows[1]!.id, 'sheet'));

    await waitFor(() => expect(explained).toHaveLength(1));
    expect(explained[0]).toEqual({ senderIds: [rows[1]!.senderId] });
    expect(rescored).toHaveLength(0);
  });

  it('leaves the stale row the user expanded to its re-score — never both', async () => {
    const rows = staleTemplateQueue();
    renderScreen(rows);

    act(() => useTriageStore.getState().setExpandedRow(rows[0]!.id));

    await waitFor(() => expect(rescored).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 40));
    expect(explained).toHaveLength(0);
  });

  it('asks for stale rows in onboarding, where nothing re-scores', async () => {
    const rows = staleTemplateQueue();
    renderScreen(rows, 'first_relief');

    await waitFor(() => expect(explained).toHaveLength(1));
    expect([...explained[0]!.senderIds].sort()).toEqual(
      [rows[0]!.senderId, rows[1]!.senderId].sort(),
    );
  });
});
