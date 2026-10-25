import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn() }));
vi.mock('@declutrmail/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: () => <span aria-hidden="true" />,
}));

const row = SCREENER_QUEUE[0]!;

beforeEach(() => {
  window.history.replaceState(null, '', '/senders?view=first-review');
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
  it('keeps archived Delete discoverable when both age-filtered counts are zero and submits the selected scope', async () => {
    const counts = (all: number) => ({
      all,
      olderThan30d: 0,
      olderThan90d: 0,
      olderThan180d: 0,
      olderThan365d: 0,
    });
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => jsonOk({ data: { counts: counts(0), allMail: { counts: counts(2) } } }),
      },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: {
              senderId: row.senderId,
              verb: 'delete',
              resolved: true,
              execution: { kind: 'noop', reason: 'no_matching_messages' },
            },
          });
        },
      },
    ]);
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen
          presentation="senders"
          state={{ kind: 'ready', rows: [{ ...row, inboxCount: 0, isProtected: false }] }}
        />
      </QueryWrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Delete' }));
    await screen.findByText('No emails match these choices.');
    const archived = screen.getByRole('checkbox', { name: 'Include archived email' });
    const confirm = screen.getByRole('button', { name: `Delete for ${row.senderName}` });
    expect(archived).not.toBeChecked();
    expect(archived).toBeEnabled();
    expect(confirm).toBeDisabled();
    fireEvent.click(archived);
    expect(archived).toBeChecked();
    expect(confirm).toBeDisabled();
    expect(bodies).toHaveLength(0);
    fireEvent.change(screen.getByRole('combobox', { name: 'Email age' }), {
      target: { value: 'all' },
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      '2 emails will move to Gmail Trash.',
    );
    expect(screen.getByRole('region', { name: 'What Delete will do' })).toHaveTextContent(
      'Inbox and archived email · Any age',
    );
    fireEvent.click(confirm);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ senderId: row.senderId, verb: 'delete', reach: 'all_mail' });
    expect(bodies[0]).not.toHaveProperty('olderThanDays');
  });

  it('carries the originating view and dormant directory search into sender details', () => {
    window.history.replaceState(
      null,
      '',
      '/senders?q=weekly&has_inbox_mail=true&view=first-review',
    );
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen presentation="senders" state={{ kind: 'ready', rows: [row] }} />
      </QueryWrapper>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    const href = screen.getByRole('link', { name: 'Open sender' }).getAttribute('href')!;
    expect(new URL(href, 'http://localhost').searchParams.get('returnTo')).toBe(
      '/senders?q=weekly&has_inbox_mail=true&view=first-review',
    );
  });
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

  it('hides an empty-Inbox Later suggestion throughout the row and preview without removing Later', async () => {
    const writes = vi.fn();
    const emptyLater = {
      ...row,
      inboxCount: 0,
      isProtected: false,
      recommendation: {
        verdict: 'later' as const,
        confidence: 0.4,
        reasoning: 'Save these messages for another time.',
      },
    };
    const counts = { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 };
    installFetchStub([
      { method: 'GET', path: '/api/actions/preview', respond: () => jsonOk({ data: { counts } }) },
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
        <ScreenerScreen presentation="senders" state={{ kind: 'ready', rows: [emptyLater] }} />
      </QueryWrapper>,
    );
    expect(screen.queryByText('Later', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('New', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    expect(screen.queryByText(/Why this is suggested/)).not.toBeInTheDocument();
    expect(screen.queryByText(emptyLater.recommendation.reasoning)).not.toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: `Decide ${row.senderName}` });
    for (const verb of ['Keep', 'Archive', 'Unsubscribe', 'Later', 'Delete']) {
      expect(within(toolbar).getByRole('button', { name: verb })).toBeEnabled();
    }
    fireEvent.keyDown(window, { key: 'l' });
    const confirm = await screen.findByRole('button', { name: `Later for ${row.senderName}` });
    await screen.findByText('No emails match these choices.');
    expect(confirm).toBeDisabled();
    expect(screen.getByLabelText('Return to inbox')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Details', { exact: true }));
    expect(screen.queryByText('Why suggested', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText(emptyLater.recommendation.reasoning)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('region', { name: /^Preview · Later / })).not.toBeInTheDocument();
    expect(writes).not.toHaveBeenCalled();
  });

  it('updates the Later suggestion when the current Inbox count changes', () => {
    const recommendation = {
      verdict: 'later' as const,
      confidence: 0.4,
      reasoning: 'Save these messages for another time.',
    };
    const client = createTestQueryClient();
    const ui = (inboxCount: number) => (
      <QueryWrapper client={client}>
        <ScreenerScreen
          presentation="senders"
          state={{ kind: 'ready', rows: [{ ...row, inboxCount, recommendation }] }}
        />
      </QueryWrapper>
    );
    const view = render(ui(2));
    expect(screen.getByText('No clear suggestion', { exact: true })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    expect(screen.getByText(recommendation.reasoning)).toBeInTheDocument();
    view.rerender(ui(0));
    expect(screen.queryByText(/Why this is suggested/)).not.toBeInTheDocument();
    expect(screen.queryByText(recommendation.reasoning)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('toolbar')).getByRole('button', { name: 'Later' }),
    ).toBeEnabled();
    view.rerender(ui(2));
    expect(screen.getByText(recommendation.reasoning)).toBeInTheDocument();
    expect(screen.getByText('Review context:')).toBeInTheDocument();
  });

  it.each([
    ['keep', 'Keep'],
    ['archive', 'Archive'],
    ['unsubscribe', 'Unsubscribe'],
  ] as const)('retains a %s recommendation at zero Inbox', (verdict, label) => {
    const reasoning = 'Existing recommendation evidence.';
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <ScreenerScreen
          presentation="senders"
          state={{
            kind: 'ready',
            rows: [
              {
                ...row,
                inboxCount: 0,
                recommendation: { verdict, confidence: 0.9, reasoning },
              },
            ],
          }}
        />
      </QueryWrapper>,
    );
    expect(screen.getByText(label, { exact: true })).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: `${row.senderName} — expand sender detail` }),
    );
    expect(screen.getByText(reasoning)).toBeInTheDocument();
  });

  it('does not own action keys while inactive and discards an unconfirmed preview', async () => {
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
    expect(screen.queryByRole('region', { name: /^Preview · Keep / })).not.toBeInTheDocument();
    view.rerender(ui(true));
    expect(screen.queryByRole('region', { name: /^Preview · Keep / })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'k' });
    expect(screen.getByRole('region', { name: /^Preview · Keep / })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /^Preview · Keep / })).not.toBeInTheDocument();
  });

  it('closes a hidden preview and re-reads the current count before arming it again', async () => {
    const client = createTestQueryClient();
    const counts = (count: number) => ({
      all: count,
      olderThan30d: count,
      olderThan90d: count,
      olderThan180d: count,
      olderThan365d: count,
    });
    let previewReads = 0;
    let finishFreshRead!: (response: Response) => void;
    const writes = vi.fn();
    installFetchStub([
      {
        method: 'GET',
        path: '/api/actions/preview',
        respond: () => {
          previewReads += 1;
          if (previewReads === 1) return jsonOk({ data: { counts: counts(4) } });
          return new Promise<Response>((resolve) => {
            finishFreshRead = resolve;
          });
        },
      },
      {
        method: 'POST',
        path: '/api/screener/decide',
        respond: () => {
          writes();
          return jsonServerError('must_not_run');
        },
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
    await waitFor(() =>
      expect(screen.getByRole('button', { name: `Archive for ${row.senderName}` })).toBeEnabled(),
    );
    expect(previewReads).toBe(1);

    view.rerender(ui(false));
    expect(screen.queryByRole('region', { name: /^Preview · Archive / })).not.toBeInTheDocument();
    view.rerender(ui(true));
    expect(screen.queryByRole('region', { name: /^Preview · Archive / })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => expect(previewReads).toBe(2));
    const confirm = screen.getByRole('button', { name: `Archive for ${row.senderName}` });
    expect(confirm).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(writes).not.toHaveBeenCalled();

    await act(async () => finishFreshRead(jsonOk({ data: { counts: counts(7) } })));
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.getByRole('region', { name: 'What Archive will do' })).toHaveTextContent('7');
    expect(writes).not.toHaveBeenCalled();
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
