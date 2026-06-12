// Storybook CSF3 stories for the account-deletion surfaces (D216, D232).
//
// Storybook is seeded in PR 3 (D210); this file uses the same
// lightweight CSF shims as the other feature stories — swap for real
// `@storybook/react` imports when the seed lands.
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type {
  AccountDeletionProjection,
  AccountDeletionStatus,
} from '@declutrmail/shared/contracts';
import { DeleteAccountModal } from './delete-account-modal';
import { GracePeriodBanner } from './grace-period-banner';
import { ACCOUNT_DELETION_QUERY_KEY } from './api/use-account-deletion';

const { color } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof DeleteAccountModal> = {
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

function frame(children: ReactNode) {
  return <div style={{ background: color.bg, minHeight: '100vh' }}>{children}</div>;
}

/** Step 1 — acknowledgment: what's deleted vs. what's never touched. */
export const ModalStep1: Story<typeof DeleteAccountModal> = {
  args: baseModalArgs,
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Step 2 (reach via Continue) — flat 7-day grace, no undo tokens. */
export const ModalFlatGrace: Story<typeof DeleteAccountModal> = {
  args: baseModalArgs,
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Step 2 with the D232 undo-window extension + waiver copy. */
export const ModalUndoWindow: Story<typeof DeleteAccountModal> = {
  args: { ...baseModalArgs, projection: UNDO_PROJECTION },
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

/** Server rejected the phrase (DELETION_CONFIRM_MISMATCH). */
export const ModalSubmitError: Story<typeof DeleteAccountModal> = {
  args: {
    ...baseModalArgs,
    submitError: 'The confirmation phrase did not match. Type it exactly to continue.',
  },
  render: (args) => frame(<DeleteAccountModal {...args} />),
};

function bannerWith(status: AccountDeletionStatus) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ACCOUNT_DELETION_QUERY_KEY, status);
  return frame(
    <QueryClientProvider client={client}>
      <GracePeriodBanner />
    </QueryClientProvider>,
  );
}

/** Grace banner — flat 7-day schedule, cancellable. */
export const BannerFlatGrace: Story<typeof GracePeriodBanner> = {
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
export const BannerUndoWindow: Story<typeof GracePeriodBanner> = {
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
export const BannerExecuting: Story<typeof GracePeriodBanner> = {
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
