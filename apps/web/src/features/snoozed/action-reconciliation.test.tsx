import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LaterReturnRecoverySummary, SnoozedSenderRow } from '@declutrmail/shared/contracts';

import { reconcileAction } from '@/lib/api/reconcile-action';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { refreshAfterUndo } from '@/features/undo/refresh-after-undo';

import { LaterReturnAlert } from './later-return-alert';
import { SnoozedScreen } from './snoozed-screen';

vi.mock('@/features/auth/api/use-me', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUserTimeZone: () => 'UTC',
}));

const ROW: SnoozedSenderRow = {
  senderId: '6f1f2f3a-0000-4000-8000-000000000001',
  displayName: 'Audit Digest',
  email: 'digest@example.test',
  domain: 'example.test',
  laterCount: 3,
  snoozedUntil: '2099-01-01T10:00:00.000Z',
  snoozedAt: '2026-10-15T10:00:00.000Z',
  reason: null,
  returnStatus: 'scheduled',
  lastReturnAttemptAt: null,
  returnFailureKind: null,
};

afterEach(() => resetFetchStub());

describe('Later readers after a sender action', () => {
  it('shows newly moved mail immediately in a warmed empty Later list', async () => {
    let rows: SnoozedSenderRow[] = [];
    let reads = 0;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/snoozed',
        respond: () => {
          reads += 1;
          return jsonOk({ data: rows });
        },
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
      </QueryWrapper>,
    );
    try {
      await screen.findByText('Nothing in Later');
      expect(reads).toBe(1);
      rows = [ROW];
      act(() => reconcileAction(client, { verb: 'later', status: 'done', direction: 'forward' }));
      expect(await screen.findByText('Audit Digest')).toBeInTheDocument();
      expect(screen.getByText('3 in Later')).toBeInTheDocument();
      expect(reads).toBe(2);
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('clears the warmed Later row and recovery alert after confirmed Undo', async () => {
    let rows: SnoozedSenderRow[] = [{ ...ROW, returnStatus: 'retrying' }];
    let recovery: LaterReturnRecoverySummary = {
      affectedCount: 1,
      firstIssue: {
        senderId: ROW.senderId,
        displayName: ROW.displayName,
        email: ROW.email,
        snoozedUntil: ROW.snoozedUntil,
        returnStatus: 'retrying',
        lastReturnAttemptAt: '2026-10-15T11:00:00.000Z',
        returnFailureKind: 'temporary',
      },
    };
    installFetchStub([
      { method: 'GET', path: '/api/snoozed', respond: () => jsonOk({ data: rows }) },
      {
        method: 'GET',
        path: '/api/snoozed/recovery',
        respond: () => jsonOk({ data: recovery }),
      },
    ]);
    const client = createTestQueryClient();
    const view = render(
      <QueryWrapper client={client}>
        <SnoozedScreen />
        <LaterReturnAlert enabled />
      </QueryWrapper>,
    );
    try {
      await screen.findByText('3 in Later');
      expect(await screen.findByTestId('later-return-alert')).toBeInTheDocument();
      rows = [];
      recovery = { affectedCount: 0, firstIssue: null };
      await act(async () => refreshAfterUndo(client));
      expect(await screen.findByText('Nothing in Later')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByTestId('later-return-alert')).toBeNull());
    } finally {
      view.unmount();
      client.clear();
    }
  });
});
