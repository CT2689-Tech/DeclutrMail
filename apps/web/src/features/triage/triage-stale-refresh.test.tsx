// Attention-scoped re-score on the Triage queue (D25 `stale_refresh`,
// founder decision 2026-08-19 — option 1A).
//
// Context these tests encode: no trigger in production revisits an
// existing sender. `sync_complete` scores every sender once at initial
// sync, `signal_change` fires only for a first-seen sender, and the
// documented weekly `cron_sweep` has no producer. So a queue row's
// verdict + reasoning are written once and then age indefinitely while
// the statistics rendered beside them are recomputed on every request.
//
// The queue refreshes the row the user EXPANDS, and only that row. A
// sweep over all twelve was considered and rejected: the queue orders by
// stored confidence and drops any row whose verdict flips to Keep, so
// refreshing everything on load re-sorts the list and can retire a card
// mid-decision.

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { TRIAGE_QUEUE, TRIAGE_SESSION_STATS, type TriageDecisionRow } from './data';
import { resetTriageStore, useTriageStore } from './store';
import { TriageScreen } from './triage-screen';

let posted: Array<Record<string, unknown>>;

/** The queue's first row, marked with an engine read of the given age. */
function rowsWith(overrides: Partial<TriageDecisionRow>): TriageDecisionRow[] {
  const [first, ...rest] = TRIAGE_QUEUE;
  return [{ ...first!, ...overrides }, ...rest];
}

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

beforeEach(() => {
  resetTriageStore();
  posted = [];
  window.sessionStorage.clear();
  installFetchStub([
    {
      method: 'POST',
      path: '/api/triage/score-sender',
      respond: async (req: Request) => {
        posted.push((await req.json()) as Record<string, unknown>);
        return jsonOk({ data: { idempotencyKey: 'k' } });
      },
    },
  ]);
});

afterEach(() => {
  resetFetchStub();
  resetTriageStore();
  vi.restoreAllMocks();
});

describe('Triage — refreshing an aged-out read', () => {
  it('asks for a fresh read when an aged-out row is expanded', async () => {
    const rows = rowsWith({ stale: true, scoredAt: '2026-07-30T00:00:00.000Z' });
    renderScreen(rows);
    // Nothing has the user's attention yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(0);

    useTriageStore.getState().setExpandedRow(rows[0]!.id);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ senderId: rows[0]!.senderId, reason: 'stale' });
  });

  it('leaves a row alone whose read is still inside its TTL', async () => {
    const rows = rowsWith({ stale: false, scoredAt: '2026-08-19T00:00:00.000Z' });
    renderScreen(rows);
    useTriageStore.getState().setExpandedRow(rows[0]!.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(0);
  });

  /**
   * A row from a fixture or the public simulator carries no `stale`
   * flag at all. Absent is UNKNOWN, not "aged out" — asking the engine
   * to re-score a sender we have no TTL fact about is guessing, and on
   * the simulator there is no authenticated mailbox to score against.
   */
  it('treats an absent staleness flag as unknown, not as stale', async () => {
    const rows = rowsWith({});
    expect(rows[0]!.stale).toBeUndefined();
    renderScreen(rows);
    useTriageStore.getState().setExpandedRow(rows[0]!.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(0);
  });

  /**
   * D112 — onboarding fixes the practice set for the length of the step
   * ("the practice set must not shift under the user mid-step"). A
   * re-score is precisely what would shift it: the verdict can change,
   * which re-sorts the queue and can remove the card being taught. The
   * refresh is therefore off for every journey except the daily ritual.
   */
  it('never re-scores during onboarding, however stale the read', async () => {
    const rows = rowsWith({ stale: true, scoredAt: '2026-07-30T00:00:00.000Z' });
    renderScreen(rows, 'first_relief');
    useTriageStore.getState().setExpandedRow(rows[0]!.id);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(0);
  });

  /**
   * Collapsing and re-expanding the same row is the same attention, not
   * a new one — and the read stays stale until the fresh row lands, so
   * without a guard the page would keep asking while the worker is
   * still scoring.
   */
  it('asks once per sender however often the row is reopened', async () => {
    const rows = rowsWith({ stale: true, scoredAt: '2026-07-30T00:00:00.000Z' });
    renderScreen(rows);
    const id = rows[0]!.id;
    useTriageStore.getState().setExpandedRow(id);
    await waitFor(() => expect(posted).toHaveLength(1));
    useTriageStore.getState().setExpandedRow(null);
    useTriageStore.getState().setExpandedRow(id);
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toHaveLength(1);
  });
});
