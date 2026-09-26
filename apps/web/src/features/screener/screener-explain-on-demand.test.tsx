// Explanations on demand in the Screener (D24, founder decision
// 2026-09-25). A Screener row's reason is read in its expanded body and in
// the decide preview's "Why suggested" — so opening a row is the moment to
// ask for its sentence. The rest of the queue, scanned by name and mail
// count, asks for nothing.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { SCREENER_QUEUE, type ScreenerQueueRow } from './data';
import { ScreenerScreen } from './screener-screen';

vi.mock('@/features/auth/auth-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOptionalAuth: () => ({
    me: {
      activeMailboxId: 'mailbox-a',
      mailboxes: [{ id: 'mailbox-a', email: 'owner@example.com', readiness: 'ready' }],
    },
  }),
}));

let explained: Array<{ senderIds: string[] }>;

/** Every fixture row on a fresh template read. */
function templateRows(): ScreenerQueueRow[] {
  return SCREENER_QUEUE.map((row) => ({
    ...row,
    recommendation: row.recommendation
      ? {
          ...row.recommendation,
          generatedBy: 'template' as const,
          stale: false,
          scoredAt: '2026-09-25T08:30:00.000Z',
        }
      : null,
  }));
}

beforeEach(() => {
  explained = [];
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
  ]);
});

afterEach(() => {
  resetFetchStub();
  vi.restoreAllMocks();
});

describe('Screener — explaining a reason when a row is opened', () => {
  it('asks for the opened row only — never the whole queue', async () => {
    const rows = templateRows();
    const opened = rows.find((row) => row.recommendation !== null)!;
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen state={{ kind: 'ready', rows }} />
      </QueryWrapper>,
    );
    await new Promise((r) => setTimeout(r, 40));
    expect(explained).toHaveLength(0);

    fireEvent.click(
      screen.getByRole('button', { name: `${opened.senderName} — expand sender detail` }),
    );

    await waitFor(() => expect(explained).toHaveLength(1));
    expect(explained[0]).toEqual({ senderIds: [opened.senderId] });
  });
});
