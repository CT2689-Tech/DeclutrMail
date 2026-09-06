import { buildActionReceiptResult } from '@declutrmail/shared/actions';
import { ReceiptStrip } from './receipt-strip';

const receipt = {
  ...buildActionReceiptResult({
    actionId: 'story-delete',
    verb: 'delete',
    direction: 'forward',
    status: 'done',
    requestedCount: 313,
    affectedCount: 313,
    wakeAt: null,
    undoToken: 'story-undo',
    undoExpiresAt: '2099-09-30T12:00:00.000Z',
    undoExecutedAt: null,
    undoRevertedAt: null,
    errorCode: null,
  }),
  senderCount: 1,
  senderName: 'Cointelegraph',
};

export default {
  title: 'Senders/ReceiptStrip',
  component: ReceiptStrip,
  parameters: { layout: 'padded' },
};

export const Deleted = {
  args: { receipt, onUndo: () => undefined, onDismiss: () => undefined },
};

export const PartiallyCompleted = {
  args: { ...Deleted.args, receipt: { ...receipt, outcome: 'partial', affectedCount: 300 } },
};

export const NothingToMove = {
  args: {
    ...Deleted.args,
    receipt: {
      ...receipt,
      outcome: 'no-op',
      affectedCount: 0,
      activityUndo: { state: 'unavailable', token: null, deadline: null },
    },
  },
};
