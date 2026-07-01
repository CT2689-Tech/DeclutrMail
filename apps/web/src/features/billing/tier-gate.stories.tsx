// Storybook CSF3 stories for the TierGate (D68/D77, D210).
//
// Under-tier workspaces see the D68 placeholder + upgrade CTA; granted
// tiers render the wrapped feature untouched. Prices come off the D19
// manifest — no literals in the gate.
//
// Mirrors the local-shim pattern used by sibling stories (D210).

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import { AuthProvider } from '@/features/auth/auth-provider';
import { ME_QUERY_KEY, type Me } from '@/features/auth/api/use-me';

import { TierGate } from './tier-gate';

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
    cleanupRemaining: tier === 'free' ? 5 : null,
  };
}

function frame(tier: Me['tier']) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  client.setQueryData(ME_QUERY_KEY, meFixture(tier));
  return (
    <div style={{ background: tokens.color.bg, minHeight: 480, padding: 12 }}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TierGate
            capability="brief"
            title="Your Morning Brief"
            pitch="A daily summary of yesterday's email, written in plain English — 8am daily, in-app or by email."
            bullets={[
              'REPLY — what actually needs you',
              'FYI — facts to know',
              'NOISE — one-click archive',
            ]}
          >
            <div
              style={{
                padding: 32,
                fontFamily: tokens.font.sans,
                color: tokens.color.fg,
              }}
            >
              (The real Brief renders here for granted tiers.)
            </div>
          </TierGate>
        </AuthProvider>
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof TierGate> = {
  title: 'Features/Billing/TierGate',
  component: TierGate,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Entitlement gate for Pro feature screens (D68/D77). Renders children only when the workspace tier grants the capability per the D19 manifest; under-tier workspaces get the placeholder + upgrade CTA and the feature fetch never fires.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Free workspace — D68 placeholder + manifest-price upgrade CTA. */
export const UnderTier: Story<typeof TierGate> = {
  render: (_args: ComponentProps<typeof TierGate>) => frame('free'),
};

/** Pro workspace — children render untouched. */
export const Granted: Story<typeof TierGate> = {
  render: (_args: ComponentProps<typeof TierGate>) => frame('pro'),
};
