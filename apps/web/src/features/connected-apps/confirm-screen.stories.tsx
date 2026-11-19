// Storybook CSF3 stories for the MCP connector's confirm page
// (`/confirm/<previewId>`, ADR-0048 rule 1, docs/spec/mcp-connector.md
// §3). Local CSF shims per the existing stories pattern; the card is
// presentational.
//
//   • Archive · Delete90Days · Later · Unsubscribe · Keep — one per verb
//   • UnsubscribeAndArchive · UnsubscribeAndDelete · ConfirmedEarlierUnsubscribeAndArchive
//                                      — Unsubscribe that also clears the
//                                        senders' existing email, in one confirmation
//   • OneSender · UnnamedAppLongNames  — singular copy; text that wraps
//   • ManySenders                      — five listed, the rest behind a disclosure
//   • ConfirmedEarlier                 — pressed before, no result on record
//   • Confirming                       — the button is locked in flight
//   • MonthlyLimit · MailboxDisconnected · UnsubscribeOff · NotStarted ·
//     ConfirmFailed                    — the press did not go through
//   • Receipt · ReceiptFinished · ReceiptKeep · ReceiptPartial ·
//     ReceiptNothingStarted · ReceiptMailto · ReceiptUnsubscribeAndArchive ·
//     ReceiptUnsubscribeAndDelete      — what confirming did
//   • DidNotComplete                   — the job failed: never a receipt
//   • Loading · Unavailable · Expired · LoadFailed

import type { ActionPreviewOutcome, ActionPreviewView } from '@declutrmail/shared/contracts';

import { ConfirmCard, type ConfirmCardState } from './confirm-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
};

const meta: StoryMeta<typeof ConfirmCard> = {
  title: 'Connect/ConfirmCard',
  component: ConfirmCard,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Where a person confirms what an assistant prepared: who asked, which Gmail account, the senders, the count, where the email goes and how to undo — then the verb.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

const PREVIEW: ActionPreviewView = {
  id: '0198d95f-a409-7000-8000-000000000001',
  verb: 'archive',
  state: 'pending',
  appName: 'Claude',
  mailboxEmail: 'ada@example.com',
  senderCount: 7,
  emailCount: 412,
  senderNames: ['The Shop', 'Daily Deals', 'Travel Club', 'Gadget News', 'Fitness Weekly'],
  olderThanDays: null,
  wakeAt: null,
  expiresAt: '2026-11-18T20:15:00.000Z',
  confirmedAt: null,
  outcome: null,
};

const OUTCOME: ActionPreviewOutcome = {
  appliedSenders: 7,
  requestedEmails: 412,
  actionStatus: 'queued',
  skipped: [],
};

const ready = (
  preview: Partial<ActionPreviewView> = {},
  overrides: Partial<Extract<ConfirmCardState, { kind: 'ready' }>> = {},
): Story<typeof ConfirmCard> => ({
  args: {
    state: {
      kind: 'ready',
      preview: { ...PREVIEW, ...preview },
      confirming: false,
      failure: null,
      onConfirm: () => {},
      ...overrides,
    },
  },
});

const receipt = (
  outcome: Partial<ActionPreviewOutcome> = {},
  preview: Partial<ActionPreviewView> = {},
): Story<typeof ConfirmCard> => {
  const merged = { ...OUTCOME, ...outcome };
  return {
    args: {
      state: {
        kind: 'applied',
        preview: { ...PREVIEW, state: 'applied', outcome: merged, ...preview },
        outcome: merged,
      },
    },
  };
};

export const Archive = ready();
export const Delete90Days = ready({ verb: 'delete', emailCount: 1_284, olderThanDays: 90 });
export const Later = ready({
  verb: 'later',
  senderCount: 2,
  senderNames: ['The Shop', 'Daily Deals'],
  emailCount: 38,
  wakeAt: '2026-11-25T09:00:00.000Z',
});
export const Unsubscribe = ready({ verb: 'unsubscribe', emailCount: 0 });
export const Keep = ready({ verb: 'keep', emailCount: 0 });
export const UnsubscribeAndArchive = ready({ verb: 'unsubscribe', alsoVerb: 'archive' });
export const ConfirmedEarlierUnsubscribeAndArchive = ready({
  verb: 'unsubscribe',
  alsoVerb: 'archive',
  state: 'confirmed',
});
export const UnsubscribeAndDelete = ready({
  verb: 'unsubscribe',
  alsoVerb: 'delete',
  olderThanDays: 90,
  emailCount: 1_284,
});
export const OneSender = ready({ senderCount: 1, senderNames: ['The Shop'], emailCount: 1 });
export const UnnamedAppLongNames = ready({
  appName: null,
  mailboxEmail:
    'a.very.long.address.that.has.to.wrap.somewhere@a-long-workplace-domain.example.com',
  senderCount: 1_000,
  senderNames: [
    'A sender whose display name goes on for much longer than any reasonable display name should',
    'no-reply-notifications-and-updates@transactional.mail.a-long-domain.example.com',
  ],
});
export const ManySenders = ready({
  verb: 'delete',
  senderCount: 40,
  emailCount: 2_310,
  senderNames: Array.from(
    { length: 38 },
    (_, index) => `Sender ${String(index + 1).padStart(2, '0')}`,
  ),
});
export const ConfirmedEarlier = ready({ state: 'confirmed' });
export const Confirming = ready({}, { confirming: true });
export const MonthlyLimit = ready({}, { failure: 'limit' });
export const MailboxDisconnected = ready({}, { failure: 'mailbox' });
export const UnsubscribeOff = ready(
  { verb: 'unsubscribe', emailCount: 0 },
  { failure: 'unsubscribe_off' },
);
export const NotStarted = ready({}, { failure: 'not_started' });
export const ConfirmFailed = ready({}, { failure: 'unknown' });

export const Receipt = receipt();
export const ReceiptFinished = receipt({ actionStatus: 'done' });
export const ReceiptKeep = receipt(
  { appliedSenders: 2, requestedEmails: 0, actionStatus: null },
  { verb: 'keep', senderCount: 2 },
);
export const ReceiptPartial = receipt({
  appliedSenders: 4,
  requestedEmails: 260,
  skipped: [
    { senderId: 's1', name: 'My Bank', reason: 'protected', composeUrl: null },
    { senderId: 's2', name: null, reason: 'not_found', composeUrl: null },
    { senderId: 's3', name: 'Busy Co', reason: 'in_progress', composeUrl: null },
  ],
});
export const ReceiptNothingStarted = receipt(
  {
    appliedSenders: 0,
    requestedEmails: 0,
    actionStatus: null,
    skipped: [{ senderId: 's1', name: 'My Bank', reason: 'protected', composeUrl: null }],
  },
  { verb: 'delete', senderCount: 1, senderNames: ['My Bank'] },
);
export const ReceiptMailto = receipt(
  {
    appliedSenders: 1,
    requestedEmails: 0,
    skipped: [
      {
        senderId: 's1',
        name: 'The Club',
        reason: 'mailto',
        composeUrl:
          'https://mail.google.com/mail/?authuser=ada%40example.com&view=cm&fs=1&to=leave%40club.example&su=unsubscribe',
      },
      { senderId: 's2', name: 'Plain Corp', reason: 'no_channel', composeUrl: null },
      { senderId: 's3', name: 'New Corp', reason: 'unknown', composeUrl: null },
    ],
  },
  { verb: 'unsubscribe', senderCount: 4, emailCount: 0 },
);
export const ReceiptUnsubscribeAndArchive = receipt(
  {
    appliedSenders: 7,
    skipped: [
      {
        senderId: 's1',
        name: 'The Club',
        reason: 'mailto',
        emailMoved: true,
        composeUrl:
          'https://mail.google.com/mail/?authuser=ada%40example.com&view=cm&fs=1&to=leave%40club.example&su=unsubscribe',
      },
    ],
  },
  { verb: 'unsubscribe', alsoVerb: 'archive' },
);
export const ReceiptUnsubscribeAndDelete = receipt(
  {
    appliedSenders: 6,
    requestedEmails: 380,
    skipped: [
      {
        senderId: 's1',
        name: 'Plain Corp',
        reason: 'no_channel',
        emailMoved: true,
        composeUrl: null,
      },
      { senderId: 's2', name: 'My Bank', reason: 'protected', emailMoved: false, composeUrl: null },
    ],
  },
  { verb: 'unsubscribe', alsoVerb: 'delete' },
);
export const DidNotComplete = receipt({ actionStatus: 'failed' });

export const Loading: Story<typeof ConfirmCard> = { args: { state: { kind: 'loading' } } };
export const Unavailable: Story<typeof ConfirmCard> = { args: { state: { kind: 'unavailable' } } };
export const Expired: Story<typeof ConfirmCard> = {
  args: { state: { kind: 'expired', confirmedEarlier: false } },
};

/** Pressed in time, but nothing was recorded as started before the window closed. */
export const ExpiredAfterConfirming: Story<typeof ConfirmCard> = {
  args: { state: { kind: 'expired', confirmedEarlier: true } },
};
export const LoadFailed: Story<typeof ConfirmCard> = {
  args: { state: { kind: 'error', onRetry: () => {} } },
};
