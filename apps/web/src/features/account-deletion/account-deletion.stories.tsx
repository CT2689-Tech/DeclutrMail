// Storybook CSF3 stories for the account-deletion surfaces (D216, D232).
//
// Variants (D211 edge-state coverage):
//   • ModalStep1            — acknowledgment step (what's deleted / not)
//   • ModalFlatGrace        — step 2, 7-day schedule, no undo tokens
//   • ModalUndoWindow       — step 2, D232 undo-extended date + waiver copy
//   • ModalSubmitError      — phrase-mismatch error surfaced
//   • BannerFlatGrace       — red grace banner, cancel affordance
//   • BannerUndoWindow      — banner + undo-window explanation
//   • BannerExecuting       — point of no return (no cancel)

import type { ComponentProps, ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type {
  AccountDeletionProjection,
  AccountDeletionStatus,
} from '@declutrmail/shared/contracts';
import { DeleteAccountModal } from './delete-account-modal';
import { AccountDeletionSection } from './account-deletion-section';
import { GracePeriodBanner } from './grace-period-banner';
import { ACCOUNT_DELETION_QUERY_KEY } from './api/use-account-deletion';
import { ME_QUERY_KEY } from '@/features/auth/api/me-contract';

const { color } = tokens;

const meta: Meta<typeof DeleteAccountModal> = {
  title: 'Account/AccountDeletion',
  component: DeleteAccountModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Account deletion (D216) with D232 undo-window-aware scheduling: typed confirm ' +
          '(DELETE schedules at max(now+7d, latest undo expiry); DELETE AND WAIVE UNDO is ' +
          'immediate and forfeits open undo windows) plus the grace-period banner.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ModalArgs = ComponentProps<typeof DeleteAccountModal>;

const FLAT_PROJECTION: AccountDeletionProjection = {
  flatGraceAt: '2026-06-18T00:00:00.000Z',
  latestUndoExpiresAt: null,
  activeUndoCount: 0,
  projectedEffectiveAt: '2026-06-18T00:00:00.000Z',
  projectedBasis: 'flat-grace',
};

const UNDO_PROJECTION: AccountDeletionProjection = {
  flatGraceAt: '2026-06-18T00:00:00.000Z',
  latestUndoExpiresAt: '2026-07-06T00:00:00.000Z',
  activeUndoCount: 3,
  projectedEffectiveAt: '2026-07-06T00:00:00.000Z',
  projectedBasis: 'undo-window',
};

const noop = () => {};

const baseModalArgs: ModalArgs = {
  open: true,
  projection: FLAT_PROJECTION,
  onCancel: noop,
  onConfirm: noop,
  isSubmitting: false,
  submitError: null,
};

function frame(children: ReactNode, status?: AccountDeletionStatus) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(ME_QUERY_KEY, { user: { timezone: 'UTC' } });
  if (status) client.setQueryData(ACCOUNT_DELETION_QUERY_KEY, status);
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>
    </QueryClientProvider>
  );
}

/** Step 1 — acknowledgment: what's deleted vs. what's never touched. */
export const ModalStep1: StoryObj<typeof DeleteAccountModal> = {
  args: baseModalArgs,
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Step 2 (reach via Continue) — flat 7-day grace, no undo tokens. */
export const ModalFlatGrace: StoryObj<typeof DeleteAccountModal> = {
  args: baseModalArgs,
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Step 2 with the D232 undo-window extension + waiver copy. */
export const ModalUndoWindow: StoryObj<typeof DeleteAccountModal> = {
  args: { ...baseModalArgs, projection: UNDO_PROJECTION },
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Server rejected the phrase (DELETION_CONFIRM_MISMATCH). */
export const ModalSubmitError: StoryObj<typeof DeleteAccountModal> = {
  args: {
    ...baseModalArgs,
    submitError: 'The confirmation phrase did not match. Type it exactly to continue.',
  },
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

function bannerWith(status: AccountDeletionStatus) {
  return frame(<GracePeriodBanner />, status);
}

/** Grace banner — flat 7-day schedule, cancellable. */
export const BannerFlatGrace: StoryObj<typeof GracePeriodBanner> = {
  render: () =>
    bannerWith({
      projection: FLAT_PROJECTION,
      request: {
        id: 'req-1',
        requestedAt: '2026-06-11T00:00:00.000Z',
        effectiveAt: '2026-06-18T00:00:00.000Z',
        basis: 'flat-grace',
        waiverConfirmed: false,
        status: 'pending',
      },
    }),
};

/** Grace banner — D232 undo-window extension explained. */
export const BannerUndoWindow: StoryObj<typeof GracePeriodBanner> = {
  render: () =>
    bannerWith({
      projection: UNDO_PROJECTION,
      request: {
        id: 'req-2',
        requestedAt: '2026-06-11T00:00:00.000Z',
        effectiveAt: '2026-07-06T00:00:00.000Z',
        basis: 'undo-window',
        waiverConfirmed: false,
        status: 'pending',
      },
    }),
};

/** Executing — past the point of no return; no cancel affordance. */
export const BannerExecuting: StoryObj<typeof GracePeriodBanner> = {
  render: () =>
    bannerWith({
      projection: FLAT_PROJECTION,
      request: {
        id: 'req-3',
        requestedAt: '2026-06-11T00:00:00.000Z',
        effectiveAt: '2026-06-11T00:05:00.000Z',
        basis: 'waived-immediate',
        waiverConfirmed: true,
        status: 'executing',
      },
    }),
};

/** Billing cannot yet be confirmed stopped: actionable, no false deletion promise. */
export const BillingBlocked: StoryObj<typeof AccountDeletionSection> = {
  render: () =>
    frame(<AccountDeletionSection />, {
      request: null,
      projection: FLAT_PROJECTION,
      billingBlockReason: 'verification',
    }),
};
export const BannerBillingBlocked: StoryObj<typeof GracePeriodBanner> = {
  render: () =>
    bannerWith({
      projection: FLAT_PROJECTION,
      billingBlockReason: 'subscription',
      request: {
        id: 'req-blocked',
        requestedAt: '2026-06-11T00:00:00Z',
        effectiveAt: '2026-06-11T00:00:00Z',
        basis: 'waived-immediate',
        waiverConfirmed: true,
        status: 'pending',
      },
    }),
};
