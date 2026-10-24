import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { AutopilotRoute } from './autopilot-screen';
import { AUTO_UNSUBSCRIBE_NOISY } from './fixtures';
import { FIXTURE_RULES } from './sender-rule-browser-data.fixture';
import { senderRulesSupportProbeInterval } from './api/use-sender-rules';

const auth = vi.hoisted(() => ({
  me: { activeMailboxId: 'mailbox-a' as string | null, tier: 'pro' as 'pro' | 'free' },
}));
vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => auth,
  getActiveMailboxEmail: () => 'active@example.invalid',
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

const clients: QueryClient[] = [];
beforeEach(() => {
  auth.me = { activeMailboxId: 'mailbox-a', tier: 'pro' };
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:4000');
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllEnvs();
});

function fixture(initialStatus: number, deferPause = false) {
  let senderStatus = initialStatus;
  let preset = { ...AUTO_UNSUBSCRIBE_NOISY, mode: 'active' as 'active' | 'paused' };
  let senderRules = [FIXTURE_RULES[0]!];
  let completePause: (() => void) | undefined;
  const pausedResponse = () => {
    const pausedCount = [preset, ...(senderStatus === 200 ? senderRules : [])].filter(
      (rule) => rule.mode !== 'paused',
    ).length;
    preset = { ...preset, mode: 'paused' };
    senderRules = senderRules.map((rule) => ({ ...rule, mode: 'paused' }));
    return jsonOk({ data: { pausedCount } });
  };
  const pause = vi.fn(() =>
    deferPause
      ? new Promise<Response>((resolve) => {
          completePause = () => resolve(pausedResponse());
        })
      : pausedResponse(),
  );
  const senderRead = vi.fn(() =>
    senderStatus === 200
      ? jsonOk({ data: senderRules })
      : new Response(
          JSON.stringify({
            error: { code: senderStatus === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE' },
          }),
          { status: senderStatus, headers: { 'content-type': 'application/json' } },
        ),
  );
  installFetchStub([
    { method: 'GET', path: '/api/autopilot/rules', respond: () => jsonOk({ data: [preset] }) },
    {
      method: 'GET',
      path: '/api/autopilot/pending-suggestions',
      respond: () =>
        jsonOk({ data: [], meta: { total: 0, pagination: { hasMore: false, nextCursor: null } } }),
    },
    {
      method: 'GET',
      path: '/api/autopilot/pattern-suggestion',
      respond: () => jsonOk({ data: null }),
    },
    { method: 'GET', path: '/api/autopilot/sender-rules', respond: senderRead },
    { method: 'POST', path: '/api/autopilot/pause-all', respond: pause },
  ]);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const tree = () => (
    <QueryClientProvider client={client}>
      <AutopilotRoute />
    </QueryClientProvider>
  );
  const view = render(tree());
  return {
    rerender: () => view.rerender(tree()),
    client,
    pause,
    completePause: () => {
      if (!completePause) throw new Error('Pause request is not pending');
      completePause();
    },
    senderRead,
    setStatus: (value: number) => {
      senderStatus = value;
    },
  };
}

it('keeps legacy Pause all available and confirmed when the sender-rule endpoint is missing', async () => {
  const state = fixture(404);
  const pause = await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  expect(pause).toBeEnabled();
  expect(screen.queryByTestId('sender-rule-library')).not.toBeInTheDocument();
  // The route retains the support probe after unmounting the new library.
  expect(
    state.client
      .getQueryCache()
      .find({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] })
      ?.getObserversCount(),
  ).toBe(1);
  fireEvent.click(pause);
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByRole('heading', { name: 'Pause all Autopilot rules?' }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText(
      'The complete rule list is unavailable. All rules in this mailbox will pause.',
    ),
  ).toBeInTheDocument();
  expect(state.pause).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Pause all' }));
  await waitFor(() => expect(state.pause).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Pause every Autopilot rule' })).toBeDisabled();
});

it('recovers from the legacy preset surface to the growing library without a reload', async () => {
  const state = fixture(404);
  await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  state.setStatus(200);
  await act(() =>
    state.client.invalidateQueries({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] }),
  );
  expect(await screen.findByTestId('sender-rule-library')).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Newsletter cleanup' })).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Pause every Autopilot rule' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause all' })).toBeEnabled();
  expect(state.senderRead).toHaveBeenCalledTimes(2);
});

it('keeps an open preset preview and focus through recovery, then returns focus to its heading', async () => {
  const state = fixture(404);
  const opener = await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
  cancel.focus();
  await waitFor(() => expect(cancel).toHaveFocus());
  expect(
    within(dialog).getByRole('heading', { name: 'Pause all Autopilot rules?' }),
  ).toBeInTheDocument();

  state.setStatus(200);
  await act(() =>
    state.client.invalidateQueries({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] }),
  );
  expect(await screen.findByTestId('sender-rule-library')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(cancel).toHaveFocus();
  expect(
    within(dialog).getByRole('heading', { name: 'Pause 2 Autopilot rules?' }),
  ).toBeInTheDocument();
  fireEvent.click(within(dialog).getByText('Details'));
  const affectedRules = within(dialog).getByRole('list', { name: 'Rules that will pause' });
  expect(within(affectedRules).getAllByRole('listitem')).toHaveLength(2);
  expect(within(affectedRules).getByText('Newsletter cleanup')).toBeInTheDocument();
  cancel.focus();
  const heading = screen.getByRole('heading', { name: 'Preset rules', level: 2 });
  expect(heading.closest('details')).toHaveAttribute('open');
  expect(opener).not.toBeInTheDocument();

  fireEvent.click(cancel);
  await waitFor(() => expect(heading).toHaveFocus());
  expect(state.pause).not.toHaveBeenCalled();
});

it('keeps a pending preset pause through recovery and completes its focus handoff', async () => {
  const state = fixture(404, true);
  const opener = await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  const previewTitle = within(dialog).getByRole('heading', { name: 'Pause all Autopilot rules?' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Pause all' }));
  await waitFor(() => expect(state.pause).toHaveBeenCalledOnce());
  expect(within(dialog).getByRole('button', { name: 'Pausing…' })).toBeDisabled();
  await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
  const focused = document.activeElement;

  state.setStatus(200);
  await act(() =>
    state.client.invalidateQueries({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] }),
  );
  expect(await screen.findByTestId('sender-rule-library')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByRole('heading', { name: 'Pause all Autopilot rules?' })).toBe(
    previewTitle,
  );
  expect(
    within(dialog).getByText(
      'The complete rule list is unavailable. All rules in this mailbox will pause.',
    ),
  ).toBeInTheDocument();
  expect(document.activeElement).toBe(focused);
  expect(within(dialog).getByRole('button', { name: 'Pausing…' })).toBeDisabled();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(state.pause).toHaveBeenCalledOnce();

  await act(async () => state.completePause());
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Preset rules', level: 2 })).toHaveFocus(),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pause all' })).toBeDisabled());
  expect(
    screen.getByRole('heading', { name: 'Preset rules', level: 2 }).closest('details'),
  ).toHaveAttribute('open');
});

it('preserves a visible preset opener when cancelling without capability recovery', async () => {
  fixture(404);
  const opener = await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});

it('keeps the plan CTA after a downgrade even when the missing-endpoint error is cached', async () => {
  const state = fixture(404);
  await screen.findByRole('button', { name: 'Pause every Autopilot rule' });
  auth.me.tier = 'free';
  state.rerender();
  expect(
    await screen.findByRole('heading', { name: 'Make room with your own rules' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Pause every Autopilot rule' }),
  ).not.toBeInTheDocument();
  expect(state.senderRead).toHaveBeenCalledOnce();
});

it('keeps a server failure visible in the growing library instead of claiming the API is older', async () => {
  fixture(500);
  expect(
    await screen.findByRole('heading', { name: 'Sender rules unavailable' }),
  ).toBeInTheDocument();
  expect(screen.getByTestId('sender-rule-library')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Pause every Autopilot rule' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause all' })).toBeDisabled();
});

it.each([
  [new ApiError(404, {}, 'missing endpoint'), 15000],
  [new ApiError(401, {}, 'authentication'), false],
  [new ApiError(402, {}, 'plan'), false],
  [new ApiError(403, {}, 'forbidden'), false],
  [new ApiError(409, {}, 'mailbox'), false],
  [new ApiError(500, {}, 'server'), false],
  [new TypeError('Failed to fetch'), false],
  [{ status: 404 }, false],
  [null, false],
])('probes only a real missing-endpoint response: %s', (error, interval) => {
  expect(senderRulesSupportProbeInterval(error)).toBe(interval);
});
