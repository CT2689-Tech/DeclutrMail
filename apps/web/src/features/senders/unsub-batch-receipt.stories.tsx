// Storybook CSF3 stories for the multi-sender unsubscribe receipt (D248, D210).
//
// The receipt reports what a batch actually did: the three terminal
// outcomes the unsubscribe worker records, plus the senders the batch
// could not send for, named per capability state. It never says
// "unsubscribed" and never folds "unconfirmed" into accepted or failed.

import type { ComponentProps } from 'react';
import { UnsubBatchReceipt } from './unsub-batch-receipt';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
};

const meta: StoryMeta<typeof UnsubBatchReceipt> = {
  title: 'Senders/UnsubBatchReceipt',
  component: UnsubBatchReceipt,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Result of a multi-sender unsubscribe (D248). Aggregates the three terminal outcomes the worker writes — accepted / unconfirmed / failed — and never collapses them into a success-vs-failure tally. Carries no Undo: a delivered unsubscribe cannot be recalled (D58), which is why the confirm preview is the reversal point (D226).',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type ReceiptArgs = ComponentProps<typeof UnsubBatchReceipt>;

const noop = () => undefined;

/** The D248 worked example: 8 one-click · 4 mailto · 2 none · 1 unknown. */
export const MixedSelection: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 8,
      capabilities: { one_click: 8, mailto: 4, none: 2, unknown: 1 },
      outcomes: { endpointAccepted: 6, unconfirmed: 1, failed: 1 },
      pending: 0,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};

/** Requests still going out — no outcome is claimed yet. */
export const StillSending: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 5,
      capabilities: { one_click: 5, mailto: 0, none: 0, unknown: 0 },
      outcomes: null,
      pending: 5,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};

/**
 * Deploy skew — the batch finished but this API build reports no
 * outcome breakdown. The receipt points at Activity instead of
 * inventing a success/failure split.
 */
export const OutcomesUnreported: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 4,
      capabilities: { one_click: 4, mailto: 0, none: 0, unknown: 0 },
      outcomes: null,
      pending: 0,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};

/** Every request accepted; the caveat still qualifies what that means. */
export const AllAccepted: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 3,
      capabilities: { one_click: 3, mailto: 0, none: 0, unknown: 0 },
      outcomes: { endpointAccepted: 3, unconfirmed: 0, failed: 0 },
      pending: 0,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};

/** Sent, and we could not establish what happened. Its own outcome. */
export const AllUnconfirmed: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 2,
      capabilities: { one_click: 2, mailto: 0, none: 0, unknown: 1 },
      outcomes: { endpointAccepted: 0, unconfirmed: 2, failed: 0 },
      pending: 0,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};

/** Nothing got through — the alert tone, with no undo offered. */
export const AllFailed: Story<typeof UnsubBatchReceipt> = {
  args: {
    receipt: {
      senderCount: 4,
      capabilities: { one_click: 4, mailto: 1, none: 0, unknown: 0 },
      outcomes: { endpointAccepted: 0, unconfirmed: 0, failed: 4 },
      pending: 0,
    },
    onDismiss: noop,
  } satisfies ReceiptArgs,
};
