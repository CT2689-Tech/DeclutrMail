import type * as CheckoutModule from './checkout';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@/features/auth/auth-provider', () => {
  const auth = () => ({
    me: {
      user: { id: 'u', workspaceId: 'chunk-fixture' },
      tier: 'free',
      cleanupRemaining: 3,
      mailboxes: [],
      activeMailboxId: null,
    },
  });
  return { useAuth: auth, useOptionalAuth: auth };
});
vi.mock('./checkout', async (importOriginal) => {
  const original = await importOriginal<typeof CheckoutModule>();
  return {
    ...original,
    launchCheckout: vi.fn().mockRejectedValue(new original.CheckoutLaunchError(true)),
  };
});
vi.mock('./checkout-recovery', () => {
  throw new Error('synthetic recovery chunk unavailable');
});
vi.mock('@/lib/posthog', () => ({ track: vi.fn() }));
import { BillingScreen } from './billing-screen';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';
import { installFetchStub, jsonOk } from '@/test/fetch-stub';
import { clearPendingCheckout, readPendingCheckout } from './pending-checkout';
it('a failed optional recovery chunk leaves payment reconciliation and its reservation accessible', async () => {
  clearPendingCheckout('chunk-fixture');
  installFetchStub([
    {
      method: 'GET',
      path: '/api/billing/subscription',
      respond: () =>
        jsonOk({
          data: {
            tier: 'free',
            foundingMember: false,
            complimentary: null,
            subscription: null,
            pendingCheckout: null,
            checkoutSetupComplete: true,
          },
        }),
    },
    {
      method: 'POST',
      path: '/api/billing/reconcile',
      respond: () => jsonOk({ data: { outcome: 'none_found' } }),
    },
    {
      method: 'POST',
      path: '/api/billing/checkout',
      respond: () =>
        jsonOk({
          data: {
            provider: 'paddle',
            kind: 'overlay',
            priceId: 'pri_test',
            clientToken: 'synthetic',
            environment: 'sandbox',
            customData: { workspace_id: 'chunk-fixture', sig: 'synthetic' },
          },
        }),
    },
  ]);
  render(
    <QueryWrapper client={createTestQueryClient()}>
      <BillingScreen initialIntent={{ plan: 'pro', cycle: 'monthly' }} />
    </QueryWrapper>,
  );
  const panel = await screen.findByTestId('checkout-panel');
  fireEvent.click(within(panel).getByRole('button', { name: 'Continue to checkout' }));
  const notice = await screen.findByTestId('payment-processing-notice');
  expect(notice).toHaveTextContent('Checkout started');
  expect(
    await screen.findByRole('button', { name: /Check payment status|Check again/i }),
  ).toBeInTheDocument();
  expect(readPendingCheckout('chunk-fixture')?.kind).toBe('checkout_intent');
  expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).not.toBeInTheDocument();
  clearPendingCheckout('chunk-fixture');
});
