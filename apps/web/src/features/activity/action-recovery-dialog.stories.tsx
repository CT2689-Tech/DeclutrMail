// Storybook CSF3 stories for the failed-action recovery review (D210).
//
// The dialog is presentational over a verified preview: every state below
// is one `ActionRecoveryPreviewResult` the server can return. Same
// local-shim pattern as the other activity stories until the PR-3
// Storybook seed merges.

import type { ComponentProps } from 'react';

import type { ActivityRowWire } from '@/lib/api/activity';
import type { ActionRecoveryPreviewResult } from '@/lib/api/actions';
import { ApiError } from '@/lib/api/client';

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
          'Review for a failed Archive / Later / Delete. Gmail is checked first; nothing changes until the reader confirms (D226). A Protected sender (D245) is named at this decision point, and the button that carries the consent says "anyway". Delete confirms in the danger tone.',
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
  },
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
 * reviewed decision, so the review says so, with the reason, and the
 * button carries the consent.
 */
export const ProtectedSender: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: { ...READY, senderProtected: true, protectionReason: 'starred' },
  } satisfies DialogArgs,
};

/** A legacy message-list action has no single sender to name. */
export const ProtectedNoSingleSender: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    row: { ...ROW, sender: null },
    preview: { ...READY, senderProtected: true, protectionReason: null },
  } satisfies DialogArgs,
};

/** Gmail already reflects it: confirming only updates the record. */
export const AlreadyApplied: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: { ...READY, outcome: 'already_applied', remainingCount: 0, alreadyAppliedCount: 42 },
  } satisfies DialogArgs,
};

/**
 * …unless the sender is Protected: the retry re-applies its whole set, so
 * mail moved back since would change — the consent is asked here too.
 */
export const AlreadyAppliedProtected: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: {
      ...READY,
      outcome: 'already_applied',
      remainingCount: 0,
      alreadyAppliedCount: 42,
      senderProtected: true,
      protectionReason: 'replied',
    },
  } satisfies DialogArgs,
};

/** The sender turned Protected after this review loaded: back to Gmail, no dead retry. */
export const RefusedProtectedSince: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: READY,
    confirmError: new ApiError(
      409,
      { error: { code: 'RECOVERY_SENDER_PROTECTED', message: 'Protected now.' } },
      'Protected now.',
    ),
  } satisfies DialogArgs,
};

/** The same refusal on a message-list action: no single sender to name. */
export const RefusedProtectedSinceNoSingleSender: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    row: { ...ROW, sender: null },
    preview: READY,
    confirmError: new ApiError(
      409,
      { error: { code: 'RECOVERY_SENDER_PROTECTED', message: 'Protected now.' } },
      'Protected now.',
    ),
  } satisfies DialogArgs,
};

/** Confirmed: the retry is starting, and the dialog cannot be dismissed mid-request. */
export const Confirming: Story<typeof ActionRecoveryDialog> = {
  args: { ...base, preview: READY, isConfirming: true } satisfies DialogArgs,
};

/** A Later whose saved return time has passed asks for a new one. */
export const LaterNeedsNewTime: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    row: { ...ROW, action: 'later' },
    preview: { ...READY, verb: 'later', requiresNewWakeAt: true },
  } satisfies DialogArgs,
};

/** Checking Gmail. */
export const Checking: Story<typeof ActionRecoveryDialog> = {
  args: { ...base, preview: undefined, isStarting: true } satisfies DialogArgs,
};

/** The check itself failed: nothing changed, and it can be run again. */
export const CheckFailed: Story<typeof ActionRecoveryDialog> = {
  args: {
    ...base,
    preview: undefined,
    startError: new Error('Network request failed'),
  } satisfies DialogArgs,
};
