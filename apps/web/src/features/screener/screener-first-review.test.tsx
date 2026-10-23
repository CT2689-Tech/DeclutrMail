import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstReviewWorkspace } from '@/features/senders/first-review-workspace';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError } from '@/test/fetch-stub';
import { SCREENER_QUEUE } from './data';
import { ScreenerScreen } from './screener-screen';

const access = vi.hoisted(() => ({
  granted: true,
  queue: vi.fn(),
  count: vi.fn(),
  capability: vi.fn(),
}));

vi.mock('@/features/billing/tier-gate', () => ({
  TierGate: ({
    capability,
    title,
    children,
  }: {
    capability: string;
    title: string;
    children: ReactNode;
  }) => {
    access.capability(capability);
    return access.granted ? children : <h2>{title}</h2>;
  },
}));
vi.mock('./api/use-screener', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useScreenerQueue: access.queue,
  useScreenerCount: access.count,
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));

const row = SCREENER_QUEUE[0]!;

beforeEach(() => {
  installFetchStub();
  access.granted = true;
  access.capability.mockClear();
  access.queue.mockReset().mockReturnValue({
    data: [...SCREENER_QUEUE],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  access.count.mockReset().mockReturnValue({ data: { pending: 3259 } });
});

describe('Needs first review in Senders', () => {
  it('retains the capability gate before mounting queue or count reads', () => {
    access.granted = false;
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <FirstReviewWorkspace navigation={<a href="/senders">All senders</a>} />
      </QueryWrapper>,
    );
    expect(screen.getByRole('heading', { name: 'Senders', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All senders' })).toHaveAttribute('href', '/senders');
    expect(access.capability).toHaveBeenCalledWith('screener');
    expect(access.queue).not.toHaveBeenCalled();
    expect(access.count).not.toHaveBeenCalled();
  });

  it('uses the actual queue and true count without another set of filter controls', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <FirstReviewWorkspace />
      </QueryWrapper>,
    );
    expect(
      screen.getByRole('heading', { name: 'Needs first review', level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText('3,259')).toBeInTheDocument();
    expect(
      screen.getByText(`Showing ${SCREENER_QUEUE.length} of 3,259 senders awaiting review`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('How the Screener works')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(
      SCREENER_QUEUE.length,
    );
  });

  it('does not invent a recommendation for a sender with no history', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen
          presentation="senders"
          state={{ kind: 'ready', rows: [{ ...row, recommendation: null }] }}
        />
      </QueryWrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.queryByText(/Why this is suggested/)).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: `Decide ${row.senderName}` })).toBeInTheDocument();
  });

  it('navigating between sender details does not decide or remove a first-review row', () => {
    const writes = vi.fn();
    installFetchStub([
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          writes();
          return jsonServerError('must_not_run');
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen
          presentation="senders"
          state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }}
        />
      </QueryWrapper>,
    );
    for (const sender of SCREENER_QUEUE) {
      fireEvent.click(
        screen.getByRole('button', { name: `${sender.senderName} — expand sender detail` }),
      );
    }
    expect(writes).not.toHaveBeenCalled();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(
      SCREENER_QUEUE.length,
    );
  });

  it('does not own action keys while inactive, including an already-open preview', async () => {
    const writes = vi.fn();
    installFetchStub([
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          writes();
          return jsonServerError('must_not_run');
        },
      },
    ]);
    const client = createTestQueryClient();
    const ui = (active: boolean) => (
      <QueryWrapper client={client}>
        <ScreenerScreen
          active={active}
          presentation="senders"
          state={{ kind: 'ready', rows: [row] }}
        />
      </QueryWrapper>
    );
    const view = render(ui(false));
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.queryByRole('region', { name: /^Preview · Keep / })).not.toBeInTheDocument();
    view.rerender(ui(true));
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByRole('region', { name: /^Preview · Keep / })).toBeInTheDocument();
    view.rerender(ui(false));
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await Promise.resolve();
    expect(writes).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: /^Preview · Keep / })).toBeInTheDocument();
    view.rerender(ui(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /^Preview · Keep / })).not.toBeInTheDocument();
  });

  it('continues confirming the original action while its view is inactive', async () => {
    const client = createTestQueryClient();
    const invalidations = vi.spyOn(client, 'invalidateQueries');
    const counts = { all: 4, olderThan30d: 4, olderThan90d: 4, olderThan180d: 4, olderThan365d: 4 };
    let status = 'queued';
    installFetchStub([
      { method: 'GET', path: '/api/actions/preview', respond: () => jsonOk({ data: { counts } }) },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () =>
          jsonOk({
            data: {
              senderId: row.senderId,
              verb: 'archive',
              resolved: false,
              execution: {
                kind: 'enqueued',
                actionId: 'first-review-action',
                status: 'queued',
                requestedCount: 4,
              },
            },
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/first-review-action',
        respond: () =>
          jsonOk({
            data: {
              actionId: 'first-review-action',
              status,
              requestedCount: 4,
              affectedCount: status === 'done' ? 4 : 0,
            },
          }),
      },
    ]);
    const ui = (active: boolean) => (
      <QueryWrapper client={client}>
        <ScreenerScreen
          active={active}
          presentation="senders"
          state={{ kind: 'ready', rows: [row] }}
        />
      </QueryWrapper>
    );
    const view = render(ui(true));
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    fireEvent.keyDown(window, { key: 'a' });
    const confirm = await screen.findByRole('button', { name: `Archive for ${row.senderName}` });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(document.querySelector('.dm-screener-row')).toHaveAttribute('aria-busy', 'true'),
    );
    expect(screen.getByText(row.senderName)).toBeInTheDocument();
    view.rerender(ui(false));
    status = 'done';
    invalidations.mockClear();
    await client.invalidateQueries({ queryKey: ['action-status', 'first-review-action'] });
    await waitFor(() =>
      expect(document.querySelector('.dm-screener-row')).toHaveAttribute('aria-busy', 'false'),
    );
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ['screener', 'queue'] });
  });
});
