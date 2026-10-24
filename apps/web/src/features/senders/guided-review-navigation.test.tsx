import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect, useState } from 'react';
import { QueryWrapper, createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonOk, jsonServerError, resetFetchStub } from '@/test/fetch-stub';
import { MAILBOX_SCOPE_RESET_EVENT } from '@/features/mailboxes/api/reset-mailbox-cache';
import { makeSenderRow } from './testing/make-sender';
import { SendersScreen } from './senders-screen';
import { useGuidedReviewSession } from './use-guided-review-session';
import { useSendersStore } from './store';
import { SenderDetailBackLink } from './detail/sender-detail-back-link';
import { GUIDED_REVIEW_STORAGE_KEY, GUIDED_REVIEW_TTL_MS } from './guided-review-session';
import { cleanupViewHref } from '@/features/cleanup/cleanup-view';

const account = vi.hoisted(() => ({ userId: 'user-1', mailboxId: 'mailbox-1' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock('@/features/auth/auth-provider', () => {
  const useAuth = () => ({
    me: {
      user: { id: account.userId, email: 'me@example.invalid', workspaceId: 'workspace-1' },
      activeMailboxId: account.mailboxId,
      tier: 'plus',
      cleanupRemaining: null,
      mailboxes: [
        {
          id: account.mailboxId,
          email: 'me@example.invalid',
          readiness: 'ready',
          status: 'active',
        },
      ],
    },
  });
  return { useAuth, useOptionalAuth: useAuth, getActiveMailboxEmail: () => 'me@example.invalid' };
});
vi.mock('@/features/auth/api/use-me', async (original) => ({
  ...(await original<object>()),
  useUserTimeZone: () => 'UTC',
}));
vi.mock('./inspector-intent', () => ({ prefetchSenderInspector: vi.fn() }));
vi.mock('./detail/sender-detail-pane', () => ({ SenderDetailPane: () => null }));
vi.mock('@/features/inbox-report/first-landing-entry', () => ({
  InboxReportFirstLanding: () => null,
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureFeatureException: vi.fn(), addBreadcrumb: vi.fn() }));

const rows = Array.from({ length: 15 }, (_, index) =>
  makeSenderRow({
    id: index === 0 ? 'pixel' : index === 1 ? 'photos' : `google-${index}`,
    displayName:
      index === 0 ? 'Google Pixel' : index === 1 ? 'Google Photos' : `Google Sender ${index}`,
    domain: `sender-${index}.invalid`,
    inboxCount: 12,
    archivedCount: 0,
    unsubscribeMethod: 'one_click',
  }),
);
let currentInbox = 12;
let pendingSearch: Promise<Response> | null = null;
let writes = 0;
let overrideList: (() => Response | Promise<Response>) | null = null;
function ListWorkspace() {
  const [guided, setGuided] = useState(
    new URLSearchParams(window.location.search).get('view') === 'guided',
  );
  return (
    <SendersScreen
      guided={guided}
      onStartGuided={() => {
        const params = new URLSearchParams(window.location.search);
        params.set('view', 'guided');
        window.history.pushState(null, '', `/senders?${params}`);
        setGuided(true);
      }}
      onExitGuided={() => {
        window.history.pushState(null, '', cleanupViewHref('all', window.location.search));
        setGuided(false);
      }}
    />
  );
}
function renderList() {
  const client = createTestQueryClient();
  return render(
    <QueryWrapper client={client}>
      <ListWorkspace />
    </QueryWrapper>,
  );
}
async function startSelected() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Google Pixel' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Google Photos' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review selected (2)' }));
  await screen.findByRole('region', { name: 'Current sender' }, { timeout: 10000 });
  fireEvent.click(screen.getByRole('button', { name: 'Next sender' }));
  await waitFor(() =>
    expect(
      within(screen.getByRole('region', { name: 'Current sender' })).getByRole('heading', {
        name: 'Google Photos',
      }),
    ).toBeInTheDocument(),
  );
}
function savedRecord() {
  return JSON.parse(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)!);
}

beforeEach(() => {
  vi.restoreAllMocks();
  account.userId = 'user-1';
  account.mailboxId = 'mailbox-1';
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', '/senders?q=Google&sort=name&direction=asc');
  useSendersStore.setState({ sort: 'total', direction: 'desc' });
  currentInbox = 12;
  pendingSearch = null;
  writes = 0;
  overrideList = null;
  installFetchStub([
    {
      method: 'GET',
      path: '/api/senders',
      respond: (_req, url) =>
        overrideList
          ? overrideList()
          : pendingSearch && url.searchParams.get('q') === 'Photos'
            ? pendingSearch
            : jsonOk({
                data: rows,
                meta: {
                  pagination: { nextCursor: null, hasMore: false, limit: 50 },
                  query: { totalMatching: 15, asOf: '2026-10-23T00:00:00Z' },
                },
              }),
    },
    {
      method: 'GET',
      path: '/api/senders/suggest',
      respond: () => jsonOk({ data: { senders: [] } }),
    },
    {
      method: 'GET',
      path: /^\/api\/senders\/[^/]+$/,
      respond: (_req, url) =>
        jsonOk({
          data: {
            ...rows.find((row) => url.pathname.endsWith('/' + row.id)),
            inboxCount: currentInbox,
            recommendation: null,
          },
        }),
    },
    {
      method: 'POST',
      path: /^\/api\//,
      respond: () => {
        writes += 1;
        return jsonOk({ data: {} });
      },
    },
  ]);
});
afterEach(() => {
  cleanup();
  resetFetchStub();
  vi.useRealTimers();
  vi.restoreAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/senders');
});

describe('guided review through native sender details', () => {
  it('restores the exact selected queue/order/index on native Back and reload, with fresh facts', async () => {
    const list = renderList();
    await startSelected();
    const returnHref = window.location.pathname + window.location.search;
    expect(savedRecord()).toMatchObject({
      senderIds: ['pixel', 'photos'],
      selectedIds: ['pixel', 'photos'],
      index: 1,
    });
    const detailHref = screen
      .getByRole('link', { name: 'View sender details' })
      .getAttribute('href')!;
    expect(detailHref).toContain('/senders/photos?');
    expect(detailHref).toContain('review=');
    list.unmount();
    window.history.pushState(null, '', detailHref);
    const detail = render(<SenderDetailBackLink senderId="photos" arrow />);
    const back = await screen.findByRole('link', { name: '← Back to Guided Review' });
    expect(new URL(back.getAttribute('href')!, window.location.origin).pathname).toBe('/senders');
    expect(
      Object.fromEntries(new URL(back.getAttribute('href')!, window.location.origin).searchParams),
    ).toEqual(Object.fromEntries(new URL(returnHref, window.location.origin).searchParams));
    detail.unmount();
    // A native document navigation discards React state and query cache.
    window.history.replaceState(null, '', returnHref);
    useSendersStore.setState({ sort: 'total', direction: 'desc' });
    currentInbox = 7;
    const restoredList = renderList();
    await screen.findByRole('region', { name: 'Current sender' }, { timeout: 10000 });
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    const queue = screen.getByRole('navigation', { name: 'Senders in this review' });
    const buttons = within(queue).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('Google Pixel');
    expect(buttons[1]).toHaveAccessibleName('Google Photos');
    expect(
      within(screen.getByRole('region', { name: 'Current sender' })).getByText('7 emails in Inbox'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish review' }));
    expect(screen.getByRole('checkbox', { name: 'Select Google Pixel' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Google Photos' })).toBeChecked();
    expect(writes).toBe(0);
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
    expect(new URLSearchParams(window.location.search).has('review')).toBe(false);
    restoredList.unmount();
    window.history.replaceState(null, '', returnHref);
    renderList();
    await screen.findByRole('heading', { name: 'This review is no longer available' });
    expect(screen.queryByRole('navigation', { name: 'Senders in this review' })).toBeNull();
  });
  it('fails closed for expired, mismatched or missing explicit review tokens instead of widening to 15 senders', async () => {
    const first = renderList();
    await startSelected();
    const href = window.location.pathname + window.location.search;
    const original = savedRecord();
    first.unmount();
    const cases = [
      { ...original, createdAt: Date.now() - GUIDED_REVIEW_TTL_MS - 1, expiresAt: Date.now() - 1 },
      { ...original, mailboxId: 'another-mailbox' },
      { ...original, scope: 'another-query' },
      null,
    ];
    for (const record of cases) {
      if (record) sessionStorage.setItem(GUIDED_REVIEW_STORAGE_KEY, JSON.stringify(record));
      else sessionStorage.removeItem(GUIDED_REVIEW_STORAGE_KEY);
      window.history.replaceState(null, '', href);
      const list = renderList();
      await screen.findByRole('heading', { name: 'This review is no longer available' });
      expect(screen.queryByRole('navigation', { name: 'Senders in this review' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Current sender' })).toBeNull();
      list.unmount();
    }
    expect(writes).toBe(0);
  });
  it('blocks a scoped start while a new search still displays the previous query rows', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Google Pixel' }));
    // Let search notify the host at 400ms, then freeze its separate 150ms
    // list debounce. Visible rows still answer the old query in this gap.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.change(screen.getByRole('combobox', { name: 'Search senders' }), {
      target: { value: 'Photos' },
    });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('combobox', { name: 'Search senders' })).toHaveValue('Photos');
    expect(new URLSearchParams(window.location.search).get('q')).toBe('Photos');
    expect(screen.getByTestId('sender-results-region')).toHaveAttribute('aria-busy', 'false');
    const start = screen.getByRole('button', { name: /Review (selected|these senders)/ });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Current sender' })).toBeNull();
  });
  it('clears saved navigation on account reset and keeps ordinary native sender links unchanged', async () => {
    const list = renderList();
    await startSelected();
    const detailHref = screen
      .getByRole('link', { name: 'View sender details' })
      .getAttribute('href')!;
    act(() => window.dispatchEvent(new Event(MAILBOX_SCOPE_RESET_EVENT)));
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
    list.unmount();
    window.history.replaceState(null, '', detailHref);
    const detail = render(<SenderDetailBackLink senderId="photos" />);
    expect(screen.getByRole('link', { name: 'Back to Senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
    detail.unmount();
    window.history.replaceState(null, '', '/senders/photos?from=senders_table');
    render(<SenderDetailBackLink senderId="photos" />);
    expect(screen.getByRole('link', { name: 'Back to Senders' })).toHaveAttribute(
      'href',
      '/senders',
    );
  });
  it('hides an old native return target before effects when token, sender or expiry changes', async () => {
    const list = renderList();
    await startSelected();
    const record = savedRecord();
    list.unmount();
    window.history.replaceState(null, '', `/senders/photos?review=${record.token}`);
    const committedHrefs: Array<string | null> = [];
    function Detail() {
      useLayoutEffect(() => {
        committedHrefs.push(screen.getByRole('link').getAttribute('href'));
      });
      return <SenderDetailBackLink />;
    }
    const detail = render(<Detail />);
    await screen.findByRole('link', { name: 'Back to Guided Review' });
    committedHrefs.length = 0;
    window.history.replaceState(null, '', '/senders/photos?review=another-token');
    detail.rerender(<Detail />);
    expect(committedHrefs[0]).toBe('/senders');

    window.history.replaceState(null, '', `/senders/photos?review=${record.token}`);
    detail.rerender(<Detail />);
    await screen.findByRole('link', { name: 'Back to Guided Review' });
    committedHrefs.length = 0;
    window.history.replaceState(null, '', `/senders/pixel?review=${record.token}`);
    detail.rerender(<Detail />);
    expect(committedHrefs[0]).toBe('/senders');

    window.history.replaceState(null, '', `/senders/photos?review=${record.token}`);
    detail.rerender(<Detail />);
    await screen.findByRole('link', { name: 'Back to Guided Review' });
    committedHrefs.length = 0;
    vi.spyOn(Date, 'now').mockReturnValue(record.expiresAt);
    detail.rerender(<Detail />);
    expect(committedHrefs[0]).toBe('/senders');
  });
  it('keeps review in place with explicit recovery when storage is disabled', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderList();
    await startSelected();
    expect(screen.queryByRole('link', { name: 'View sender details' })).toBeNull();
    expect(screen.getByText(/browser couldn’t save this review/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try saving review' })).toBeInTheDocument();
    expect(writes).toBe(0);
  });
  it('shows loading and retry for an explicit selected review from default All, without falling back to Suggested', async () => {
    window.history.replaceState(null, '', '/senders');
    const list = renderList();
    await startSelected();
    const href = window.location.pathname + window.location.search;
    list.unmount();
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    overrideList = () => pending;
    window.history.replaceState(null, '', href);
    renderList();
    expect(await screen.findByRole('heading', { name: 'Guided Review' })).toBeInTheDocument();
    expect(screen.getByText('Loading your review…')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Current sender' })).toBeNull();
    await act(async () => {
      resolve(jsonServerError());
    });
    await screen.findByRole('heading', { name: 'Couldn’t load this review' });
    overrideList = null;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Current sender' }, { timeout: 10000 });
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(
      within(screen.getByRole('navigation', { name: 'Senders in this review' })).getAllByRole(
        'button',
      ),
    ).toHaveLength(2);
  });
  it('retains selected senders when exiting a native return before its rows finish loading', async () => {
    window.history.replaceState(null, '', '/senders');
    const list = renderList();
    await startSelected();
    const href = window.location.pathname + window.location.search;
    list.unmount();
    let resolve!: (value: Response) => void;
    const pending = new Promise<Response>((done) => {
      resolve = done;
    });
    overrideList = () => pending;
    window.history.replaceState(null, '', href);
    renderList();
    await screen.findByText('Loading your review…');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Senders' }));
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
    await act(async () => {
      resolve(
        jsonOk({
          data: rows,
          meta: {
            pagination: { nextCursor: null, hasMore: false, limit: 50 },
            query: { totalMatching: 15, asOf: '2026-10-23T00:00:00Z' },
          },
        }),
      );
    });
    expect(await screen.findByRole('checkbox', { name: 'Select Google Pixel' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Google Photos' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Review selected (2)' })).toBeInTheDocument();
    expect(writes).toBe(0);
  });
  it.each(['user', 'mailbox', 'scope', 'token', 'expired', 'missing'])(
    'does not restore a %s-mismatched saved selection on an early exit',
    async (mismatch) => {
      const list = renderList();
      await startSelected();
      const href = window.location.pathname + window.location.search;
      const record = savedRecord();
      list.unmount();
      if (mismatch === 'user') record.userId = 'another-user';
      if (mismatch === 'mailbox') record.mailboxId = 'another-mailbox';
      if (mismatch === 'scope') record.scope = 'another-scope';
      if (mismatch === 'token') record.token = 'another-token';
      if (mismatch === 'expired') {
        record.createdAt = Date.now() - GUIDED_REVIEW_TTL_MS - 1;
        record.expiresAt = record.createdAt + GUIDED_REVIEW_TTL_MS;
      }
      if (mismatch === 'missing') sessionStorage.removeItem(GUIDED_REVIEW_STORAGE_KEY);
      else sessionStorage.setItem(GUIDED_REVIEW_STORAGE_KEY, JSON.stringify(record));
      let resolve!: (value: Response) => void;
      const pending = new Promise<Response>((done) => {
        resolve = done;
      });
      overrideList = () => pending;
      window.history.replaceState(null, '', href);
      renderList();
      await screen.findByText('Loading your review…');
      fireEvent.click(screen.getByRole('button', { name: 'Back to Senders' }));
      await act(async () => {
        resolve(
          jsonOk({
            data: rows,
            meta: {
              pagination: { nextCursor: null, hasMore: false, limit: 50 },
              query: { totalMatching: 15, asOf: '2026-10-23T00:00:00Z' },
            },
          }),
        );
      });
      expect(
        await screen.findByRole('checkbox', { name: 'Select Google Pixel' }),
      ).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Select Google Photos' })).not.toBeChecked();
      expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
      expect(writes).toBe(0);
    },
  );
  it('does not resurrect selection cleared by a loaded action owner when exiting', async () => {
    const list = renderList();
    await startSelected();
    const record = savedRecord();
    list.unmount();
    function Owner() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      const review = useGuidedReviewSession({
        userId: 'user-1',
        mailboxId: 'mailbox-1',
        scope: record.scope,
        rows: [],
        reviewing: true,
        scopeLoading: false,
        refreshFailed: false,
        onRestoreSelection: setSelected,
        selectedIds: selected,
      });
      return (
        <>
          <output aria-label="Selection count">{selected.size}</output>
          <button onClick={() => setSelected(new Set())}>Clear selection</button>
          <button onClick={review.exit}>Exit review</button>
        </>
      );
    }
    render(<Owner />);
    await waitFor(() => expect(screen.getByLabelText('Selection count')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(savedRecord().selectedIds).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Exit review' }));
    expect(screen.getByLabelText('Selection count')).toHaveTextContent('0');
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
  });
  it('retains a validated selection when exiting a failed native return', async () => {
    const list = renderList();
    await startSelected();
    const record = savedRecord();
    list.unmount();
    function FailedReturn() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      const review = useGuidedReviewSession({
        userId: 'user-1',
        mailboxId: 'mailbox-1',
        scope: record.scope,
        rows: [],
        reviewing: true,
        scopeLoading: false,
        refreshFailed: true,
        onRestoreSelection: setSelected,
        selectedIds: selected,
      });
      return (
        <>
          <output aria-label="Selection count">{selected.size}</output>
          <button onClick={review.exit}>Back to Senders</button>
        </>
      );
    }
    render(<FailedReturn />);
    expect(screen.getByLabelText('Selection count')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Senders' }));
    expect(screen.getByLabelText('Selection count')).toHaveTextContent('2');
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
  });
  it('waits for the initial owner before restoring, then clears for an actual account change', async () => {
    const list = renderList();
    await startSelected();
    const record = savedRecord();
    list.unmount();
    function Hydration({ mailboxId }: { mailboxId: string | undefined }) {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      const review = useGuidedReviewSession({
        userId: 'user-1',
        mailboxId,
        scope: record.scope,
        rows: [],
        reviewing: true,
        scopeLoading: false,
        refreshFailed: false,
        onRestoreSelection: setSelected,
        selectedIds: selected,
      });
      return (
        <p>
          {review.unavailable
            ? 'Unavailable'
            : review.session
              ? `${review.session.index + 1} of ${review.session.senderIds.length}`
              : 'Waiting for owner'}
        </p>
      );
    }
    const view = render(<Hydration mailboxId={undefined} />);
    expect(screen.getByText('Waiting for owner')).toBeInTheDocument();
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).not.toBeNull();
    view.rerender(<Hydration mailboxId="mailbox-1" />);
    await screen.findByText('2 of 2');
    expect(savedRecord().selectedIds).toEqual(['pixel', 'photos']);
    view.rerender(<Hydration mailboxId="another-mailbox" />);
    await screen.findByText('Unavailable');
    expect(sessionStorage.getItem(GUIDED_REVIEW_STORAGE_KEY)).toBeNull();
  });
});
