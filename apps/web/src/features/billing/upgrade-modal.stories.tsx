// Storybook CSF3 stories for the UpgradeModal (D19/D77/D81, D123).
//
// The modal reads the upgrade-gate store (fed in production by the
// global MutationCache 402 handler) + the workspace tier from `me`.
// Stories seed both directly so every variant of the D123 nudge
// ladder renders deterministically.
//
// Mirrors the local-shim pattern used by sibling stories (D210).

import { useEffect, type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';
import { useUpgradeGateStore, type UpgradeGateHit } from '@/lib/entitlements/upgrade-gate';

import { UpgradeModal } from './upgrade-modal';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

function meFixture(tier: Me['tier']): Me {
  return {
    user: { id: 'u-1', email: 'me@example.com', workspaceId: 'w-1' },
    activeMailboxId: 'mb-1',
    mailboxes: [
      {
        id: 'mb-1',
        email: 'me@example.com',
        status: 'active',
        connectedAt: null,
        readiness: 'ready',
      },
    ],
    tier,
    cleanupRemaining: tier === 'free' ? 0 : null,
  };
}

function SeedHit({ hit }: { hit: UpgradeGateHit }) {
  const report = useUpgradeGateStore((s) => s.report);
  useEffect(() => {
    report(hit);
  }, [report, hit]);
  return null;
}

function frame(tier: Me['tier'], hit: UpgradeGateHit) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  client.setQueryData(ME_QUERY_KEY, meFixture(tier));
  return (
    <div style={{ background: tokens.color.bg, minHeight: 480, padding: 12 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SeedHit hit={hit} />
          <UpgradeModal />
        </AuthProvider>
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof UpgradeModal> = {
  title: 'Features/Billing/UpgradeModal',
  component: UpgradeModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Global entitlement-402 upgrade flow (U13). Opens when a mutation returns FREE_CAP_REACHED or INBOX_LIMIT_REACHED; copy follows the D123 nudge ladder — Free/Plus get the upgrade CTA with the D121 money-back note, Pro gets the honest limit statement with no nudge.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Free workspace spent all 5 lifetime cleanup actions (D19). */
export const FreeCapSpent: Story<typeof UpgradeModal> = {
  render: (_args: ComponentProps<typeof UpgradeModal>) =>
    frame('free', {
      reason: 'free_cap',
      details: { remaining: 0, limit: 5, used: 5, requiredUnits: 1 },
    }),
};

/** Bulk needs more units than remain — partial-cap headline. */
export const FreeCapPartial: Story<typeof UpgradeModal> = {
  render: (_args: ComponentProps<typeof UpgradeModal>) =>
    frame('free', {
      reason: 'free_cap',
      details: { remaining: 2, limit: 5, used: 3, requiredUnits: 4 },
    }),
};

/** Plus workspace at its 1-inbox limit — nudge toward Pro (2 inboxes). */
export const InboxLimitPlus: Story<typeof UpgradeModal> = {
  render: (_args: ComponentProps<typeof UpgradeModal>) =>
    frame('plus', { reason: 'inbox_limit', details: { limit: 1, connected: 1 } }),
};

/** Pro workspace at its 2-inbox ceiling — honest statement, NO nudge (D123). */
export const InboxLimitPro: Story<typeof UpgradeModal> = {
  render: (_args: ComponentProps<typeof UpgradeModal>) =>
    frame('pro', { reason: 'inbox_limit', details: { limit: 2, connected: 2 } }),
};
