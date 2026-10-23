import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import type { SenderRule, SenderRulePreview } from '@/lib/api/autopilot-sender-rules';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { useUiStore } from '@declutrmail/shared';
import { SenderRuleLibraryScope, senderRuleFailureCopy } from './sender-rule-library';
import { AUTO_ARCHIVE_LOW_ENGAGEMENT } from './fixtures';

const api = vi.hoisted(() => ({
  tier: 'pro' as 'free' | 'pro',
  list: vi.fn(),
  search: vi.fn(),
  save: vi.fn(),
  retire: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  pause: vi.fn(),
  mode: vi.fn(),
  track: vi.fn(),
  feedback: vi.fn(),
  status: { data: undefined, isError: false, refetch: vi.fn() } as {
    data: undefined | { status: string; affectedCount: number; done: number; total: number };
    isError: boolean;
    refetch: ReturnType<typeof vi.fn>;
  },
}));
vi.mock('@/lib/api/autopilot-sender-rules', () => ({
  fetchSenderRules: api.list,
  fetchRuleSenders: api.search,
  saveSenderRule: api.save,
  retireSenderRule: api.retire,
  setSenderRuleMode: api.mode,
  previewSenderRule: api.preview,
  executeSenderRule: api.execute,
}));
vi.mock('@/lib/api/autopilot', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  postPauseAll: api.pause,
}));
vi.mock('@/lib/posthog', () => ({ track: api.track }));
vi.mock('@/lib/api/use-action', () => ({ useBatchStatus: () => api.status }));
vi.mock('@/features/undo/feedback-store', () => ({ acceptActionFeedback: api.feedback }));
vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { activeMailboxId: 'mailbox-a', tier: api.tier } }),
  getActiveMailboxEmail: () => 'test@example.invalid',
}));

const sender = (key: string, name: string, protectedSender = false) => ({
  id: `id-${key}`,
  senderKey: key.repeat(64),
  name,
  email: `${name.toLowerCase()}@example.invalid`,
  protected: protectedSender,
});
const alice = sender('a', 'Alice');
const bob = sender('b', 'Bob');
const protectedSender = sender('c', 'Family', true);
const rule: SenderRule = {
  id: 'rule-a',
  name: 'Newsletter cleanup',
  version: 1,
  enabled: true,
  mode: 'observe',
  action: 'archive',
  reach: 'inbox_only',
  olderThanDays: 90,
  senderKeys: [alice.senderKey, bob.senderKey],
  senders: [alice, bob, protectedSender],
  matchingMessageCount: 12,
  matchingSenderCount: 2,
  protectedSenderCount: 1,
  checkedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const makePreview = (
  excluded: string[] = [],
  overrides: Partial<SenderRulePreview> = {},
): SenderRulePreview => ({
  previewId: `preview-${excluded.length}`,
  ruleId: rule.id,
  version: 1,
  action: 'archive',
  reach: 'inbox_only',
  olderThanDays: 90,
  messageCount: excluded.length ? 7 : 12,
  totalEligibleCount: 12,
  hasMore: false,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  checkedAt: new Date().toISOString(),
  protectedSenderCount: 1,
  excludedSenderKeys: excluded,
  senders: [
    { ...alice, messageCount: 7 },
    { ...bob, messageCount: 5 },
    { ...protectedSender, messageCount: 0 },
  ].filter((s) => !excluded.includes(s.senderKey)),
  ...overrides,
});
const clients: QueryClient[] = [];
function setup(
  presetsAvailable = true,
  presetRules: AutopilotRuleDto[] = [
    { ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: true, mode: 'active' },
  ],
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  clients.push(client);
  const tree = () => (
    <QueryClientProvider client={client}>
      <SenderRuleLibraryScope
        mailboxId="mailbox-a"
        presetRules={presetRules}
        presetsAvailable={presetsAvailable}
      />
    </QueryClientProvider>
  );
  return { ...render(tree()), client, tree };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.mode.mockReset();
  api.tier = 'pro';
  api.list.mockResolvedValue([rule]);
  api.search.mockImplementation((q: string) =>
    Promise.resolve({
      senders: q.toLowerCase().includes('bob') ? [bob] : [alice, bob, protectedSender],
      nextCursor: null,
    }),
  );
  api.save.mockImplementation((config: object) => Promise.resolve({ ...rule, ...config }));
  api.retire.mockResolvedValue({ ...rule, enabled: false, mode: 'paused' });
  api.preview.mockImplementation((_rule: unknown, excluded: string[]) =>
    Promise.resolve(makePreview(excluded)),
  );
  api.execute.mockResolvedValue({
    previewId: 'preview-0',
    batchId: 'batch-a',
    actionIds: ['action-a', 'action-b'],
    requestedCount: 12,
    enqueueFailedCount: 0,
  });
  api.pause.mockResolvedValue({ data: { pausedCount: 2 } });
  api.status.data = undefined;
  api.status.isError = false;
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  onlineManager.setOnline(true);
  vi.useRealTimers();
});
async function loaded() {
  await screen.findByRole('heading', { name: rule.name });
}

describe('sender rule library', () => {
  it('registers approval-first help for the application shell', async () => {
    setup();
    await loaded();
    expect(useUiStore.getState().screenHelp).toMatchObject({
      id: 'autopilot-sender-rules',
      title: 'Autopilot',
    });
    expect(useUiStore.getState().screenHelp?.body).toContain('Preview and approve each batch.');
  });

  it('previews disabled non-paused presets that the global pause also changes', async () => {
    const disabled = {
      ...AUTO_ARCHIVE_LOW_ENGAGEMENT,
      id: 'disabled-preset',
      name: 'Disabled weekly preset',
      enabled: false,
      mode: 'observe' as const,
    };
    setup(true, [{ ...AUTO_ARCHIVE_LOW_ENGAGEMENT, enabled: true, mode: 'active' }, disabled]);
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Pause 3 rules?' })).toBeInTheDocument();
    expect(within(dialog).getByText('Disabled weekly preset · Observe')).toBeInTheDocument();
    expect(within(dialog).getByRole('list').children).toHaveLength(3);
    expect(api.pause).not.toHaveBeenCalled();
  });

  it('returns focus to the rule when pausing removes the options button', async () => {
    api.mode.mockResolvedValue({ ...rule, version: 2, mode: 'paused' });
    setup();
    await loaded();
    fireEvent.click(screen.getByText('Rule options'));
    const pause = screen.getByRole('button', { name: 'Pause rule' });
    pause.focus();
    fireEvent.click(pause);

    await screen.findByText('Rule paused.');
    await waitFor(() => expect(screen.getByRole('heading', { name: rule.name })).toHaveFocus());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume rule' })).toBeEnabled());
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('cannot approve the previous token while an exclusion refresh waits offline', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Archive 12 emails?' });
    act(() => onlineManager.setOnline(false));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Alice/ }));
    expect(await within(dialog).findByText('Waiting for connection…')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(api.preview).toHaveBeenCalledTimes(1);
    expect(api.execute).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await within(dialog).findByRole('heading', { name: 'Archive 7 emails?' });
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeEnabled();
  });
  it('shows the plan path on Free without treating the capability gate as an outage', async () => {
    api.tier = 'free';
    setup();
    expect(screen.getByRole('link', { name: 'Explore plans' })).toHaveAttribute('href', '/billing');
    expect(screen.getByRole('button', { name: 'New rule' })).toBeDisabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });

  it('returns focus to the rule heading after selection and editor cancellation', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getAllByRole('button', { name: /Newsletter cleanup Archive/ })[0]!);
    await waitFor(() => expect(screen.getByRole('heading', { name: rule.name })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: rule.name })).toHaveFocus());
  });

  it('keeps the focused sender mounted while an exclusion refreshes its exact preview', async () => {
    let finish!: (value: SenderRulePreview) => void;
    api.preview.mockResolvedValueOnce(makePreview()).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    const checkbox = await within(dialog).findByRole('checkbox', { name: /Alice/ });
    checkbox.focus();
    fireEvent.click(checkbox);
    await within(dialog).findByText('Refreshing preview…');
    expect(checkbox).toHaveFocus();
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeDisabled();
    await act(async () => finish(makePreview([alice.senderKey])));
    await waitFor(() => expect(checkbox).toHaveFocus());
  });

  it('clears a rule retired elsewhere after a successful library refresh', async () => {
    const { client } = setup();
    await loaded();
    api.list.mockResolvedValue([]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] });
    });
    expect(
      await screen.findByRole('heading', { name: 'Your first sender rule' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });
  it('saves a rule without previewing or executing email and retains selection across search', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'New rule' })[0]!);
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'My senders' } });
    await screen.findByRole('checkbox', { name: /Alice/ });
    fireEvent.click(screen.getByRole('checkbox', { name: /Alice/ }));
    expect(screen.getByRole('checkbox', { name: /Family/ })).toBeDisabled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search name or email' }), {
      target: { value: 'bob' },
    });
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Alice/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Remove Alice' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: /Bob/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My senders',
          senderKeys: [alice.senderKey, bob.senderKey],
          action: 'archive',
          reach: 'inbox_only',
        }),
        'mailbox-a',
        undefined,
        expect.any(String),
      ),
    );
    expect(api.execute).not.toHaveBeenCalled();
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.track).toHaveBeenCalledWith(
      'autopilot_sender_rule_changed',
      expect.objectContaining({ operation: 'create', sender_count: 2 }),
    );
    expect(JSON.stringify(api.track.mock.calls)).not.toContain('My senders');
    expect(JSON.stringify(api.track.mock.calls)).not.toContain(alice.senderKey);
  });
  it('retains the create idempotency key through an unknown Save response', async () => {
    api.save
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce((config) => Promise.resolve({ ...rule, ...config }));
    setup();
    await loaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'New rule' })[0]!);
    fireEvent.change(screen.getByLabelText('Rule name'), { target: { value: 'Retry rule' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Alice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(api.save).toHaveBeenCalledTimes(2));
    expect(api.save.mock.calls[0]![3]).toBeTruthy();
    expect(api.save.mock.calls[0]![3]).toBe(api.save.mock.calls[1]![3]);
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('keeps existing selected senders while editing and resets all-mail reach for Archive', async () => {
    api.list.mockResolvedValue([{ ...rule, action: 'delete', reach: 'all_mail' }]);
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Edit rule' }));
    expect(screen.getByRole('button', { name: 'Remove Alice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Archive' }));
    fireEvent.change(screen.getByLabelText('Search name or email'), { target: { value: 'bob' } });
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Alice/ })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() =>
      expect(api.save).toHaveBeenCalledWith(
        expect.objectContaining({
          senderKeys: [alice.senderKey, bob.senderKey],
          reach: 'inbox_only',
          action: 'archive',
        }),
        'mailbox-a',
        expect.objectContaining({ version: 1 }),
        undefined,
      ),
    );
  });
  it('requires an exact preview and refreshes it after excluding a sender', async () => {
    setup();
    await loaded();
    expect(api.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Archive 12 emails?' });
    expect(api.execute).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('checkbox', { name: /Family/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Bob/ }));
    await within(dialog).findByRole('heading', { name: 'Archive 7 emails?' });
    expect(api.preview).toHaveBeenLastCalledWith(
      rule,
      [bob.senderKey],
      expect.any(AbortSignal),
      'mailbox-a',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() =>
      expect(api.execute).toHaveBeenCalledWith(rule, 'preview-1', expect.any(String), 'mailbox-a'),
    );
    expect(api.feedback).toHaveBeenCalledWith(
      'mailbox-a',
      expect.objectContaining({ groupId: 'batch-a', verb: 'archive' }),
    );
    expect(await screen.findByText('Batch queued.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Activity and Undo' })).toHaveAttribute(
      'href',
      '/activity',
    );
  });
  it('does not equate queue acceptance or a failed progress read with completion', async () => {
    const view = setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Archive 12 emails?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await screen.findByText('Batch queued.');
    api.status.isError = true;
    view.rerender(view.tree());
    expect(screen.getByText(/Progress couldn’t be checked/)).toBeInTheDocument();
    expect(screen.queryByText('12 emails moved.')).not.toBeInTheDocument();
    api.status.isError = false;
    api.status.data = { status: 'failed', affectedCount: 7, done: 1, total: 2 };
    view.rerender(view.tree());
    expect(screen.getByText(/7 emails moved; some actions failed/)).toBeInTheDocument();
  });
  it('keeps an open preview frozen and refreshes an explicitly stale rule', async () => {
    const next = { ...rule, version: 2 };
    api.list.mockResolvedValueOnce([rule]).mockResolvedValue([next]);
    api.preview.mockImplementation((target: SenderRule, excluded: string[]) =>
      Promise.resolve(makePreview(excluded, { version: target.version })),
    );
    api.execute.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'AUTOPILOT_RULE_CHANGED' } }, 'changed'),
    );
    const view = setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Archive 12 emails?' });
    await view.client.invalidateQueries({ queryKey: ['autopilot-sender-rules', 'mailbox-a'] });
    expect(api.preview).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await within(dialog).findByText(/The rule changed/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh preview' }));
    await waitFor(() =>
      expect(api.preview).toHaveBeenLastCalledWith(next, [], expect.any(AbortSignal), 'mailbox-a'),
    );
    expect(api.execute).toHaveBeenCalledOnce();
  });
  it('blocks expired previews and provides a fresh preview', async () => {
    api.preview
      .mockResolvedValueOnce(
        makePreview([], { expiresAt: new Date(Date.now() - 1000).toISOString() }),
      )
      .mockResolvedValueOnce(makePreview([], { previewId: 'refreshed' }));
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/This preview expired/);
    expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Refresh preview' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Archive' })).toBeEnabled(),
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
  it('retries an unverified confirmation with the same idempotency key', async () => {
    api.execute.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({
      previewId: 'preview-0',
      batchId: 'batch-a',
      actionIds: ['action-a'],
      requestedCount: 12,
      enqueueFailedCount: 0,
    });
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('heading', { name: 'Archive 12 emails?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await within(dialog).findByText(/Confirmation couldn’t be verified/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.execute).toHaveBeenCalledTimes(2));
    expect(api.execute.mock.calls[0]![2]).toBe(api.execute.mock.calls[1]![2]);
  });
  it('combines custom and Active presets in global pause preview', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Pause all' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Pause 2 rules?' })).toBeInTheDocument();
    expect(within(dialog).getByText(rule.name)).toBeInTheDocument();
    expect(within(dialog).getByText(/Active/)).toBeInTheDocument();
    expect(api.pause).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause all' }));
    await waitFor(() => expect(api.pause).toHaveBeenCalledOnce());
  });
  it('disables global pause when the preset read is unavailable', async () => {
    setup(false);
    await loaded();
    expect(screen.getByRole('button', { name: 'Pause all' })).toBeDisabled();
  });
  it('paginates and searches a growing library without reading per-rule previews', async () => {
    api.list.mockResolvedValue(
      Array.from({ length: 14 }, (_, i) => ({ ...rule, id: `rule-${i}`, name: `Rule ${i}` })),
    );
    setup();
    await screen.findByRole('heading', { name: 'Rule 0' });
    expect(screen.getAllByRole('button', { name: /^Rule \d+ Archive/ })).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: /Rule 6/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search rules' }), {
      target: { value: 'Rule 13' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Rule 13/ })).toBeInTheDocument(),
    );
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.list).toHaveBeenCalledOnce();
  });
  it('renders unavailable rules without inventing zero matches', async () => {
    api.list.mockRejectedValue(new Error('unavailable'));
    setup();
    expect(
      await screen.findByRole('heading', { name: 'Sender rules unavailable' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('0 matching emails')).not.toBeInTheDocument();
  });
});

it.each([
  'AUTOPILOT_RULE_INACTIVE',
  'AUTOPILOT_RULE_CHANGED',
  'AUTOPILOT_RULE_INVALID',
  'AUTOPILOT_NOT_ENTITLED',
  'AUTOPILOT_MAILBOX_INACTIVE',
])('names exact worker stop %s', (code) => {
  expect(senderRuleFailureCopy([code])).toBeTruthy();
  expect(senderRuleFailureCopy(['UNKNOWN'])).toBeNull();
});
