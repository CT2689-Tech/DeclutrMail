/**
 * The toast for a finished one-click unsubscribe from the Screener. The
 * screen inlines the same sentences as `unsubscribeOutcomeToast` (Senders)
 * to stay off that module's chunk, so this pins the two equal: a request
 * the endpoint refused from a sender that also takes email names the Gmail
 * step instead of "failed — Archive still works".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { unsubscribeOutcomeToast } from '@/features/senders/unsub-status';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

const h = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@declutrmail/shared', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, toast: h.toast };
});
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));

const row = SCREENER_QUEUE.find((r) => r.unsubscribeMethod === 'one_click')!;
const EXEC_ID = '77777777-7777-4777-8777-777777777777';

afterEach(() => {
  resetFetchStub();
  h.toast.mockClear();
});

function installUnsubStub(errorCode: string) {
  installFetchStub([
    {
      method: 'POST',
      path: '/api/screener/decide',
      respond: () =>
        jsonOk({
          data: {
            senderId: row.senderId,
            verb: 'unsubscribe',
            resolved: true,
            execution: {
              kind: 'unsubscribe',
              method: 'one_click',
              executionActionId: EXEC_ID,
              mailtoUrl: null,
              activityLogId: 'log-1',
            },
          },
        }),
    },
    {
      method: 'GET',
      path: `/api/actions/${EXEC_ID}`,
      respond: () =>
        jsonOk({
          data: {
            actionId: EXEC_ID,
            status: 'failed',
            requestedCount: 1,
            affectedCount: 0,
            undoToken: null,
            errorCode,
          },
        }),
    },
  ]);
}

async function confirmUnsubscribe() {
  render(
    <QueryWrapper client={createTestQueryClient()}>
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
    </QueryWrapper>,
  );
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${row.senderName} — expand`) }));
  fireEvent.keyDown(window, { key: 'u' });
  fireEvent.click(
    await screen.findByRole('button', {
      name: new RegExp(`^Confirm Unsubscribe for ${row.senderName}`),
    }),
  );
}

describe('Screener one-click unsubscribe outcome toast', () => {
  it('not accepted, sender takes email: names the Gmail step, same words as Senders', async () => {
    installUnsubStub('UNSUB_MANUAL_REQUIRED');
    await confirmUnsubscribe();

    const expected = unsubscribeOutcomeToast(row.senderName, {
      status: 'failed',
      errorCode: 'UNSUB_MANUAL_REQUIRED',
    });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expected.message, expected.tone));
    expect(h.toast).not.toHaveBeenCalledWith(expect.stringMatching(/Archive still works/), 'warn');
  });

  it('refused with no email route: still offers Archive', async () => {
    installUnsubStub('UNSUB_TARGET_REJECTED');
    await confirmUnsubscribe();

    const expected = unsubscribeOutcomeToast(row.senderName, {
      status: 'failed',
      errorCode: 'UNSUB_TARGET_REJECTED',
    });
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expected.message, expected.tone));
  });
});
