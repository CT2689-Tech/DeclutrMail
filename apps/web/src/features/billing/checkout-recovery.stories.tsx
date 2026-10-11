import { CheckoutRecovery, type HeldCheckout } from './checkout-recovery';
import { PaymentProcessingNotice } from './billing-screen';
const held: HeldCheckout = {
  workspaceId: 'story-checkout',
  target: 'pro',
  cycle: 'annual',
  attemptId: 'story-attempt',
  expiresAt: Date.now() + 30 * 60 * 1000,
  session: {
    provider: 'paddle',
    kind: 'overlay',
    environment: 'sandbox',
    clientToken: 'synthetic',
    priceId: 'pri_synthetic',
    customData: { workspace_id: 'story-checkout', sig: 'synthetic' },
  },
};
export default {
  title: 'Features/Billing/CheckoutRecovery',
  component: CheckoutRecovery,
  parameters: { layout: 'padded' },
  tags: ['autodocs'],
};
export const LoaderBlocked = {
  render: () => (
    <>
      <PaymentProcessingNotice kind="checkout_intent" />
      <CheckoutRecovery
        held={held}
        mayOpen={() => false}
        onOpened={() => {}}
        onCompleted={() => {}}
        onClosed={() => {}}
      />
    </>
  ),
};
export const ExpiredWindow = {
  render: () => (
    <CheckoutRecovery
      held={{ ...held, expiresAt: 0 }}
      mayOpen={() => false}
      onOpened={() => {}}
      onCompleted={() => {}}
      onClosed={() => {}}
    />
  ),
};
