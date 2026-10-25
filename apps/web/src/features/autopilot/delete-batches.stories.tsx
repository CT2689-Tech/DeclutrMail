import { useEffect, useState, useMemo } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/auth-provider';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createSenderRuleStoryFixture } from './sender-rule-library.stories';
import { FIXTURE_SENDERS } from './sender-rule-browser-data.fixture';
import { NEWSLETTER_GRAVEYARD } from './fixtures';
import { FrozenRulePreview } from './frozen-rule-preview';
import { DeleteRuleReview } from './delete-rule-review';

type Scenario = 'ready' | 'loading' | 'error' | 'empty' | 'paused' | 'expired';
function DeleteBatches({ scenario, modal }: { scenario: Scenario; modal: boolean }) {
  const [fixture] = useState(() => createSenderRuleStoryFixture('empty'));
  const [installed, setInstalled] = useState(false);
  const rule = useMemo(
    () => ({
      ...NEWSLETTER_GRAVEYARD,
      version: 1,
      actionKind: 'delete' as const,
      actionPayload: { reach: 'all_mail' },
      enabled: true,
      mode: scenario === 'paused' ? ('paused' as const) : ('observe' as const),
    }),
    [scenario],
  );
  useEffect(() => {
    const result = (data: unknown) => jsonOk({ data });
    const unavailable = () =>
      new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), { status: 503 });
    const pending = () => new Promise<Response>(() => {});
    const count = scenario === 'empty' ? 0 : 2;
    installFetchStub([
      { method: 'GET', path: '/api/auth/me', respond: () => result(fixture.me) },
      { method: 'GET', path: '/api/autopilot/rules', respond: () => result([rule]) },
      {
        method: 'POST',
        path: `/api/autopilot/rules/${rule.id}/preview`,
        respond: () =>
          scenario === 'loading'
            ? pending()
            : scenario === 'error'
              ? unavailable()
              : result({
                  actionableMessageCount: count,
                  actionableSenderCount: count,
                  reach: 'all_mail',
                }),
      },
      {
        method: 'POST',
        path: `/api/autopilot/sender-rules/${rule.id}/preview`,
        respond: () =>
          scenario === 'loading'
            ? pending()
            : scenario === 'error'
              ? unavailable()
              : result({
                  previewId: 'story-frozen-delete',
                  ruleId: rule.id,
                  version: 1,
                  checkedAt: new Date().toISOString(),
                  expiresAt: new Date(
                    Date.now() + (scenario === 'expired' ? -1000 : 300_000),
                  ).toISOString(),
                  action: 'delete',
                  reach: 'all_mail',
                  olderThanDays: null,
                  messageCount: count,
                  totalEligibleCount: count,
                  hasMore: false,
                  protectedSenderCount: 1,
                  excludedSenderKeys: [],
                  senders: count
                    ? FIXTURE_SENDERS.slice(0, 2).map((sender) => ({ ...sender, messageCount: 1 }))
                    : [],
                }),
      },
      {
        method: 'POST',
        path: `/api/autopilot/sender-rules/${rule.id}/execute`,
        respond: () => unavailable(),
      },
    ]);
    const stub = globalThis.fetch;
    globalThis.fetch = (input, init) =>
      stub(
        input instanceof Request
          ? input
          : new Request(new URL(String(input), window.location.origin), init),
      );
    setInstalled(true);
    return () => {
      resetFetchStub();
      fixture.client.clear();
    };
  }, [fixture, scenario, rule]);
  return installed ? (
    <QueryClientProvider client={fixture.client}>
      <AuthProvider>
        {modal ? (
          <FrozenRulePreview
            target={{ kind: 'preset', rule }}
            mailboxId={fixture.mailboxId}
            available
            onCancel={() => undefined}
            onApproved={() => undefined}
          />
        ) : (
          <div style={{ padding: 24, maxWidth: 900 }}>
            <DeleteRuleReview
              rule={rule}
              mailboxId={fixture.mailboxId}
              onPreview={() => undefined}
            />
          </div>
        )}
      </AuthProvider>
    </QueryClientProvider>
  ) : (
    <p>Preparing synthetic story…</p>
  );
}
const meta = {
  title: 'Autopilot/Delete batches',
  component: DeleteBatches,
  args: { scenario: 'ready', modal: true },
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
} satisfies Meta<typeof DeleteBatches>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FrozenPreview: Story = {};
export const LoadingPreview: Story = { args: { scenario: 'loading' } };
export const FailedPreview: Story = { args: { scenario: 'error' } };
export const EmptyPreview: Story = { args: { scenario: 'empty' } };
export const PausedRule: Story = { args: { scenario: 'paused' } };
export const ExpiredPreview: Story = { args: { scenario: 'expired' } };
export const NeedsReview: Story = { args: { modal: false } };
export const CheckingMatches: Story = { args: { modal: false, scenario: 'loading' } };
export const FailedMatches: Story = { args: { modal: false, scenario: 'error' } };
export const NoMatches: Story = { args: { modal: false, scenario: 'empty' } };
