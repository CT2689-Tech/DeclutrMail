import { CancelModal } from './cancel-modal';

export default {
  title: 'Features/Billing/CancelModal',
  component: CancelModal,
  tags: ['autodocs'],
};

const args = {
  open: true,
  sub: {
    provider: 'paddle' as const,
    tier: 'pro' as const,
    status: 'active' as const,
    cycle: 'monthly' as const,
    currentPeriodEnd: '2026-11-04T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    cancelSource: null,
    pauseUntil: null,
    foundingMember: false,
    scheduledChange: null,
  },
  backsEntitlement: true,
  entitlementTier: 'pro' as const,
  onClose: () => {},
  onConfirm: () => {},
  isCanceling: false,
  cancelError: null,
  onPause: () => {},
  isPausing: false,
  pauseError: null,
};

/** Discloses immediate subscription-access loss before the pause action. */
export const PauseOffer = { args };
export const PausePending = { args: { ...args, isPausing: true } };
export const PauseError = { args: { ...args, pauseError: 'Could not pause. Try again.' } };
