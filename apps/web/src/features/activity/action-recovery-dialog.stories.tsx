// Storybook CSF3 stories for the failed-action recovery review (D210).
//
// The dialog is presentational over a verified preview: every state below
// is one `ActionRecoveryPreviewResult` the server can return. Same
// local-shim pattern as the other activity stories until the PR-3
// Storybook seed merges.

import type { ComponentProps } from 'react';

import type { ActivityRowWire } from '@/lib/api/activity';
import type { ActionRecoveryPreviewResult } from '@/lib/api/actions';

import { ActionRecoveryDialog } from './action-recovery-dialog';

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

const meta: StoryMeta<typeof ActionRecoveryDialog> = {
  title: 'Activity/ActionRecoveryDialog',
  component: ActionRecoveryDialog,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Review for a failed Archive / Later / Delete. Gmail is checked first; nothing changes until the reader confirms (D226). A Protected sender (D245) is named at this decision point, and the button that carries the consent says "anyway".',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type DialogArgs = ComponentProps<typeof ActionRecoveryDialog>;

const noop = () => {};

const ROW: ActivityRowWire = {
  id: 'a-1',
  occurredAt: '2026-09-25T08:00:00.000Z',
  source: 'manual',
  action: 'delete',
  affectedCount: 0,
  sender: {
    senderKey: 'sk-1',
    displayName: 'Yankee Candle',
    email: 'news@yankeecandle.example',
    domain: 'yankeecandle.example',
    brandMark: false,
  } as ActivityRowWire['sender'],
  rule: null,
  feedbackRating: null,
  undoState: { kind: 'unavailable' },
  executionState: null,
  reviewOutcome: null,
};

const READY: ActionRecoveryPreviewResult = {
  previewId: '22222222-2222-2222-2222-222222222222',
  actionId: '11111111-1111-1111-1111-111111111111',
  rootActionId: '11111111-1111-1111-1111-111111111111',
  verb: 'delete',
  status: 'ready',
  outcome: 'not_applied',
  targetCount: 42,
  remainingCount: 42,
  alreadyAppliedCount: 0,
  unavailableCount: 0,
  verifiedCount: 42,
  errorCode: null,
  wakeAt: null,
  requiresNewWakeAt: false,
  expiresAt: '2026-09-25T08:10:00.000Z',
  recoveryActionId: null,
  senderProtected: false,
};

const base = {
  row: ROW,
  isStarting: false,
  startError: null,
  confirmError: null,
  isConfirming: false,
  onRetryVerification: noop,
  onConfirm: noop,
  onReconnect: noop,
  onClose: noop,
} satisfies Omit<DialogArgs, 'preview'>;

/** Verified: nothing reached Gmail, so the retry does all of it. */
export const Ready: Story<typeof ActionRecoveryDialog> = {
  args: { ...base, preview: READY } satisfies DialogArgs,
};

/**
 * D245 — the sender became Protected. Bulk actions skip it; a retry is one
 * reviewed decision, so the review says so and the button carries it.
 */
export const ProtectedSender: Story<typeof ActionRecoveryDialog> = {
  args: { ...base, preview: { ...READY, senderProtected: true } } satisfies DialogArgs,
};

/** Gmail already reflects it: confirming only updates the record, so no consent line. */
export const AlreadyApplied: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: {
      ...READY,
      outcome: 'already_applied',
      remainingCount: 0,
      alreadyAppliedCount: 42,
      senderProtected: true,
    },
  } satisfies DialogArgs,
};
