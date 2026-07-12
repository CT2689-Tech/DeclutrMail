/**
 * Behavioral test for the Screener K/A/U/L/D keyboard wiring (#220).
 *
 * The main screener-screen.test renders to STATIC markup (no DOM events),
 * so the window keydown handler — expanded-row targeting, Enter/Escape,
 * the input guard — was only covered at the pure-resolver level. This
 * exercises the real handler in jsdom. Uses `keep` (no composite-preview
 * fetch) so the assertion needs no network stub.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';

import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));

function renderReady() {
  return render(
    <QueryWrapper client={createTestQueryClient()}>
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
    </QueryWrapper>,
  );
}

const PREVIEW = 'Preview · before anything changes';
const firstRow = SCREENER_QUEUE[0]!;
const noChannelRow = SCREENER_QUEUE.find((row) => row.unsubscribeMethod === 'none')!;

afterEach(() => {
  resetFetchStub();
});

function livePreviewHandler(all: number) {
  return {
    method: 'GET' as const,
    path: '/api/actions/preview',
    respond: () =>
      jsonOk({
        data: {
          sender: {
            id: firstRow.senderId,
            name: firstRow.senderName,
            domain: firstRow.senderDomain,
            lastSeenDays: 0,
            repliedCount: 0,
            monthly: 1,
          },
          counts: {
            all,
            olderThan30d: 0,
            olderThan90d: 0,
            olderThan180d: 0,
            olderThan365d: 0,
          },
          recentSubjects: {
            all: [],
            olderThan30d: [],
            olderThan90d: [],
            olderThan180d: [],
            olderThan365d: [],
          },
          unsubAvailable: true,
          protected: false,
        },
      }),
  };
}

function expandFirstRow() {
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`${firstRow.senderName} — expand`) }),
  );
}

describe('Screener keyboard handler (#220, D226)', () => {
  it('K on the EXPANDED row opens the mandatory preview (never a direct mutation)', () => {
    renderReady();
    expandFirstRow();
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  });

  it('Escape cancels the open preview', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('does nothing when NO row is expanded (no ghost preview)', () => {
    renderReady();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('a modifier chord (Cmd/Ctrl) is ignored', () => {
    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('disables click and U shortcut when the sender publishes no unsubscribe channel', () => {
    renderReady();
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`${noChannelRow.senderName} — expand`) }),
    );

    const unsubscribe = screen.getByRole('button', { name: /^Unsubscribe$/ });
    expect(unsubscribe).toBeDisabled();
    expect(unsubscribe).toHaveAttribute('title', expect.stringMatching(/No unsubscribe channel/i));
    fireEvent.keyDown(window, { key: 'u' });
    expect(screen.queryByText(PREVIEW)).not.toBeInTheDocument();
  });

  it('Enter cannot confirm Archive when its live preview is unavailable', async () => {
    let decidePosted = false;
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => jsonServerError('preview_down'),
      },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          decidePosted = true;
          return jsonServerError('must_not_run');
        },
      },
    ]);

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText(/Cancel and retry/i);

    fireEvent.keyDown(window, { key: 'Enter' });
    await Promise.resolve();
    expect(decidePosted).toBe(false);
    expect(screen.getByText(PREVIEW)).toBeInTheDocument();
  });

  it('Enter confirms Archive after the current-match preview resolves', async () => {
    let decidePosted = false;
    const actionId = '99999999-9999-4999-8999-999999999999';
    installFetchStub([
      livePreviewHandler(2),
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          decidePosted = true;
          return jsonOk({
            data: {
              senderId: firstRow.senderId,
              verb: 'archive',
              resolved: true,
              execution: { kind: 'enqueued', actionId, status: 'queued', requestedCount: 2 },
            },
          });
        },
      },
      {
        method: 'GET',
        path: `/api/actions/${actionId}`,
        respond: () =>
          jsonOk({
            data: {
              actionId,
              status: 'executing',
              requestedCount: 2,
              affectedCount: 0,
              undoToken: null,
              errorCode: null,
            },
          }),
      },
    ]);

    renderReady();
    expandFirstRow();
    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByText(/emails currently match in Inbox/i);

    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(decidePosted).toBe(true));
  });
});
