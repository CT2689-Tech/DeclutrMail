import { useEffect, useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import type {
  SenderRule,
  SenderRuleConfig,
  SenderRulePreview,
} from '@/lib/api/autopilot-sender-rules';
import { FIXTURE_RULES, FIXTURE_SENDERS } from './sender-rule-browser-data.fixture';
import { SenderRuleLibraryScope } from './sender-rule-library';

export type SenderRuleStoryScenario =
  | 'growing'
  | 'first'
  | 'empty'
  | 'loading'
  | 'error'
  | 'locked'
  | 'paused'
  | 'expired'
  | 'empty-preview'
  | 'sender-loading'
  | 'sender-error'
  | 'save-error'
  | 'saving';
const mailboxId = 'story-autopilot-mailbox';
const checkedAt = '2026-10-22T12:00:00.000Z';
const rulePath = '/api/autopilot/sender-rules';

/** Shared only by the two story files. Every unmatched request fails locally. */
export function createSenderRuleStoryFixture(scenario: SenderRuleStoryScenario) {
  const me: Me = {
    user: {
      id: 'story-user',
      workspaceId: 'story-workspace',
      email: 'story@example.invalid',
      timezone: 'UTC',
    },
    activeMailboxId: mailboxId,
    mailboxes: [
      {
        id: mailboxId,
        email: 'story@example.invalid',
        status: 'active',
        connectedAt: checkedAt,
        readiness: 'ready',
      },
    ],
    tier: scenario === 'locked' ? 'free' : 'pro',
    cleanupRemaining: null,
  };
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        retry: false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        retryOnMount: false,
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(ME_QUERY_KEY, me);
  let rules: SenderRule[] = structuredClone(FIXTURE_RULES).map((rule) => ({
    ...rule,
    checkedAt,
    updatedAt: checkedAt,
    ...(scenario === 'paused' ? { mode: 'paused' as const } : {}),
  }));
  if (scenario === 'first') rules = rules.slice(0, 2);
  if (scenario === 'empty') rules = [];
  if (!['loading', 'error', 'locked'].includes(scenario))
    client.setQueryData(['autopilot-sender-rules', mailboxId], rules);
  const senders = [
    ...FIXTURE_SENDERS,
    ...Array.from({ length: 26 }, (_, index) => ({
      id: `story-sender-${index}`,
      senderKey: index.toString(16).padStart(64, '0'),
      name: `Selected Letters ${index + 1}`,
      email: `letters-${index + 1}@example.invalid`,
      protected: false,
    })),
  ];
  const countFor = (sender: (typeof senders)[number]) =>
    sender.protected
      ? 0
      : ([7, 3, 2][FIXTURE_SENDERS.findIndex((item) => item.senderKey === sender.senderKey)] ?? 1);
  let previewNumber = 0;
  let createdNumber = 0;
  let latestPreview: SenderRulePreview | null = null;
  const saves = new Map<string, SenderRule>();
  const ok = (data: unknown) => jsonOk({ data });
  const failure = () =>
    new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  const pending = () => new Promise<Response>(() => {});
  const install = () => {
    const originalConsent = localStorage.getItem('dm-cookie-consent');
    // The restrictive local choice also overrides an existing permissive cookie.
    localStorage.setItem('dm-cookie-consent', 'essential');
    installFetchStub([
      { method: 'GET', path: '/api/auth/me', respond: () => ok(me) },
      {
        method: 'GET',
        path: rulePath,
        respond: () =>
          scenario === 'loading' ? pending() : scenario === 'error' ? failure() : ok(rules),
      },
      {
        method: 'GET',
        path: '/api/autopilot/senders',
        respond: (_request, url) => {
          if (scenario === 'sender-loading') return pending();
          if (scenario === 'sender-error') return failure();
          const query = (url.searchParams.get('q') ?? '').toLowerCase();
          const found = senders.filter((sender) =>
            `${sender.name} ${sender.email}`.toLowerCase().includes(query),
          );
          const offset = Number(url.searchParams.get('cursor') ?? 0);
          return ok({
            senders: found.slice(offset, offset + 25),
            nextCursor: found.length > offset + 25 ? String(offset + 25) : null,
          });
        },
      },
      {
        method: 'POST',
        path: rulePath,
        respond: async (request) => {
          if (scenario === 'saving') return pending();
          if (scenario === 'save-error') return failure();
          const key = request.headers.get('Idempotency-Key') ?? '';
          const previous = saves.get(key);
          if (previous) return ok(previous);
          const config = (await request.json()) as SenderRuleConfig;
          const created: SenderRule = {
            ...FIXTURE_RULES[0]!,
            ...config,
            id: `story-created-${++createdNumber}`,
            version: 1,
            senders: senders.filter((sender) => config.senderKeys.includes(sender.senderKey)),
            checkedAt,
            updatedAt: checkedAt,
          };
          created.matchingMessageCount = created.senders.reduce(
            (total, sender) => total + countFor(sender),
            0,
          );
          created.matchingSenderCount = created.senders.filter(
            (sender) => !sender.protected,
          ).length;
          created.protectedSenderCount = created.senders.filter(
            (sender) => sender.protected,
          ).length;
          rules = [created, ...rules];
          saves.set(key, created);
          return ok(created);
        },
      },
      {
        method: 'PATCH',
        path: /^\/api\/autopilot\/sender-rules\/[^/]+$/,
        respond: async (request, url) => {
          if (scenario === 'saving') return pending();
          if (scenario === 'save-error') return failure();
          const current = rules.find((rule) => rule.id === url.pathname.split('/').at(-1))!;
          const patch = (await request.json()) as Partial<SenderRuleConfig> & {
            mode?: 'observe' | 'paused';
          };
          const updated = {
            ...current,
            ...patch,
            version: current.version + 1,
            senders: senders.filter((sender) =>
              (patch.senderKeys ?? current.senderKeys).includes(sender.senderKey),
            ),
          };
          updated.matchingMessageCount = updated.senders.reduce(
            (total, sender) => total + countFor(sender),
            0,
          );
          updated.matchingSenderCount = updated.senders.filter(
            (sender) => !sender.protected,
          ).length;
          updated.protectedSenderCount = updated.senders.filter(
            (sender) => sender.protected,
          ).length;
          rules = rules.map((rule) => (rule.id === updated.id ? updated : rule));
          return ok(updated);
        },
      },
      {
        method: 'POST',
        path: /^\/api\/autopilot\/sender-rules\/[^/]+\/retire$/,
        respond: (_request, url) => {
          const current = rules.find((rule) => rule.id === url.pathname.split('/').at(-2))!;
          rules = rules.filter((rule) => rule.id !== current.id);
          return ok({ ...current, enabled: false, mode: 'paused', version: current.version + 1 });
        },
      },
      {
        method: 'POST',
        path: /^\/api\/autopilot\/sender-rules\/[^/]+\/preview$/,
        respond: async (request, url) => {
          const current = rules.find((rule) => rule.id === url.pathname.split('/').at(-2))!;
          const { excludedSenderKeys = [] } = (await request.json()) as {
            excludedSenderKeys?: string[];
          };
          const matched = current.senders
            .map((sender) => ({
              ...sender,
              messageCount: scenario === 'empty-preview' ? 0 : countFor(sender),
            }))
            .filter((sender) => !excludedSenderKeys.includes(sender.senderKey));
          const messageCount =
            scenario === 'empty-preview'
              ? 0
              : matched.reduce((total, sender) => total + sender.messageCount, 0);
          latestPreview = {
            previewId: `00000000-0000-4000-8000-${String(++previewNumber).padStart(12, '0')}`,
            ruleId: current.id,
            version: current.version,
            action: current.action,
            reach: current.reach,
            olderThanDays: current.olderThanDays,
            checkedAt,
            expiresAt: new Date(
              Date.now() + (scenario === 'expired' && previewNumber === 1 ? -1000 : 300000),
            ).toISOString(),
            messageCount,
            totalEligibleCount: messageCount,
            hasMore: false,
            protectedSenderCount: matched.filter((sender) => sender.protected).length,
            senders: matched,
            excludedSenderKeys,
          };
          return ok(latestPreview);
        },
      },
      {
        method: 'POST',
        path: /^\/api\/autopilot\/sender-rules\/[^/]+\/execute$/,
        respond: () =>
          ok({
            previewId: latestPreview?.previewId,
            batchId: 'story-batch',
            actionIds: ['story-action'],
            requestedCount: latestPreview?.messageCount ?? 0,
            enqueueFailedCount: 0,
          }),
      },
      {
        method: 'GET',
        path: '/api/actions/batch/story-batch',
        respond: () =>
          ok({
            batchId: 'story-batch',
            status: 'done',
            total: 1,
            done: 1,
            failed: 0,
            requestedCount: latestPreview?.messageCount ?? 0,
            affectedCount: latestPreview?.messageCount ?? 0,
            undoToken: null,
          }),
      },
      {
        method: 'POST',
        path: '/api/autopilot/pause-all',
        respond: () => {
          const pausedCount = rules.filter((rule) => rule.mode !== 'paused').length;
          rules = rules.map((rule) => ({ ...rule, mode: 'paused', version: rule.version + 1 }));
          return ok({ pausedCount });
        },
      },
    ]);
    const stub = globalThis.fetch;
    // Native Request needs an absolute URL; the API also supports path-only URLs.
    globalThis.fetch = (input, init) =>
      stub(
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init),
      );
    return () => {
      client.clear();
      resetFetchStub();
      if (originalConsent === null) localStorage.removeItem('dm-cookie-consent');
      else localStorage.setItem('dm-cookie-consent', originalConsent);
    };
  };
  return { client, me, install, mailboxId, firstRule: rules[0] ?? null };
}

/** Wait until isolation is installed before mounting any production hooks. */
export function SenderRuleStoryFrame({
  scenario,
  children,
}: {
  scenario: SenderRuleStoryScenario;
  children: ReactNode;
}) {
  const [fixture] = useState(() => createSenderRuleStoryFixture(scenario));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const dispose = fixture.install();
    setReady(true);
    return dispose;
  }, [fixture]);
  return ready ? (
    <QueryClientProvider client={fixture.client}>
      <AuthProvider>
        <div
          style={{
            padding: 28,
            maxWidth: 1200,
            margin: '0 auto',
            fontFamily: 'var(--dm-font-sans)',
          }}
        >
          {children}
        </div>
      </AuthProvider>
    </QueryClientProvider>
  ) : (
    <p>Preparing story…</p>
  );
}

function LibraryStory({ scenario }: { scenario: SenderRuleStoryScenario }) {
  return (
    <SenderRuleStoryFrame key={scenario} scenario={scenario}>
      <SenderRuleLibraryScope mailboxId={mailboxId} presetRules={[]} presetsAvailable />
    </SenderRuleStoryFrame>
  );
}
const meta = {
  title: 'Autopilot/SenderRuleLibrary',
  component: LibraryStory,
  args: { scenario: 'growing' },
  // Each canvas temporarily owns fetch; avoid concurrent fixtures in autodocs.
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen', controls: { disable: true } },
  excludeStories: ['createSenderRuleStoryFixture', 'SenderRuleStoryFrame'],
} satisfies Meta<typeof LibraryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const GrowingLibrary: Story = {};
export const FirstRules: Story = { args: { scenario: 'first' } };
export const Empty: Story = { args: { scenario: 'empty' } };
export const Loading: Story = { args: { scenario: 'loading' } };
export const Unavailable: Story = { args: { scenario: 'error' } };
export const PlanLocked: Story = { args: { scenario: 'locked' } };
export const AllPaused: Story = { args: { scenario: 'paused' } };
export const BatchPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }));
    await expect(await canvas.findByRole('alertdialog')).toHaveAccessibleName('Delete 12 emails?');
  },
};
export const ExpiredPreview: Story = {
  args: { scenario: 'expired' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }));
    const dialog = within(await canvas.findByRole('alertdialog'));
    await expect(await dialog.findByText(/This preview expired/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  },
};
export const NoMatchesPreview: Story = {
  args: { scenario: 'empty-preview' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }));
    const dialog = within(await canvas.findByRole('alertdialog'));
    await expect(await dialog.findByText('No matching email in this batch.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete' })).toBeDisabled();
  },
};
export const EditWithRetainedSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit rule' }));
    await userEvent.type(canvas.getByRole('searchbox', { name: 'Search name or email' }), 'Market');
    await waitFor(() => {
      expect(canvas.queryByRole('checkbox', { name: /Studio Weekly/ })).not.toBeInTheDocument();
      expect(canvas.getByRole('checkbox', { name: /Market Notes/ })).toBeVisible();
    });
    await expect(canvas.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
  },
};
async function createDraft(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('button', { name: 'New rule' }));
  await userEvent.type(canvas.getByRole('textbox', { name: 'Rule name' }), 'Senders I chose');
  await userEvent.click(await canvas.findByRole('checkbox', { name: /Studio Weekly/ }));
  return canvas;
}
export const CreateRule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await createDraft(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Remove Studio Weekly' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save rule' })).toBeEnabled();
  },
};
export const SavingRule: Story = {
  args: { scenario: 'saving' },
  play: async ({ canvasElement }) => {
    const canvas = await createDraft(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save rule' }));
    await expect(await canvas.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  },
};
export const SaveUnavailable: Story = {
  args: { scenario: 'save-error' },
  play: async ({ canvasElement }) => {
    const canvas = await createDraft(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save rule' }));
    await expect(await canvas.findByRole('alert')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Save rule' })).toBeEnabled();
  },
};

export const ExcludedSenderPreview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Preview' }));
    const dialog = within(await canvas.findByRole('alertdialog'));
    await dialog.findByRole('heading', { name: 'Delete 12 emails?' });
    await userEvent.click(dialog.getByRole('checkbox', { name: /Market Notes/ }));
    await expect(await dialog.findByRole('heading', { name: 'Delete 9 emails?' })).toBeVisible();
  },
};
