import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { FrozenRulePreview } from './frozen-rule-preview';
import { NEWSLETTER_GRAVEYARD } from './fixtures';
import { createTestQueryClient } from '@/test/query-wrapper';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { tier: 'pro', activeMailboxId: 'mb' } }),
  getActiveMailboxEmail: () => 'synthetic@example.invalid',
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));

const rule = {
  ...NEWSLETTER_GRAVEYARD,
  version: 1,
  actionKind: 'delete' as const,
  mode: 'observe' as const,
  enabled: true,
  actionPayload: { reach: 'all_mail' },
};
describe('frozen preset preview recovery', () => {
  it('replaces the bounded candidate universe on explicit refresh instead of accumulating more than 100 identities', async () => {
    let version = 1;
    const requests: { includedSenderKeys?: string[]; excludedSenderKeys: string[] }[] = [];
    installFetchStub([
      {
        method: 'GET',
        path: '/api/autopilot/rules',
        respond: () => {
          version = 2;
          return jsonOk({ data: [{ ...rule, version }] });
        },
      },
      {
        method: 'POST',
        path: `/api/autopilot/sender-rules/${rule.id}/execute`,
        respond: () =>
          new Response(
            JSON.stringify({ error: { code: 'AUTOPILOT_RULE_CHANGED', message: 'Changed' } }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      },
      {
        method: 'POST',
        path: `/api/autopilot/sender-rules/${rule.id}/preview`,
        respond: async (req) => {
          const input = await req.json();
          requests.push(input);
          const senders = Array.from({ length: 100 }, (_, i) => ({
            id: `${version}-${i}`,
            senderKey: (version * 1000 + i).toString(16).padStart(64, '0'),
            name: `Batch ${version} sender ${i}`,
            email: 'news@example.invalid',
            protected: false,
            messageCount: 1,
          })).filter((sender) => !input.excludedSenderKeys.includes(sender.senderKey));
          return jsonOk({
            data: {
              previewId: `frozen-${version}-${senders.length}`,
              ruleId: rule.id,
              version,
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              action: 'delete',
              reach: 'all_mail',
              olderThanDays: null,
              senders,
              messageCount: senders.length,
              totalEligibleCount: senders.length,
              hasMore: false,
              protectedSenderCount: 0,
            },
          });
        },
      },
    ]);
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <FrozenRulePreview
          target={{ kind: 'preset', rule }}
          mailboxId="mb"
          available
          onCancel={vi.fn()}
          onApproved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Batch 1 sender 0');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Refresh preview' }));
    const identity = await within(dialog).findByText('Batch 2 sender 0');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled(),
    );
    expect(within(dialog).queryByText('Batch 1 sender 0')).not.toBeInTheDocument();
    fireEvent.click(within(identity.closest('label')!).getByRole('checkbox'));
    await waitFor(() => expect(requests.at(-1)?.excludedSenderKeys).toHaveLength(1));
    expect(requests.at(-1)?.includedSenderKeys).toHaveLength(100);
    expect(new Set(requests.at(-1)?.includedSenderKeys).size).toBe(100);
    expect(
      requests.at(-1)?.includedSenderKeys?.every((key) => Number.parseInt(key, 16) >= 2000),
    ).toBe(true);
  });
});
