import type { ActionReceiptResult } from '@declutrmail/shared/actions';

/**
 * The last finished action a Senders surface is holding on to — what it
 * needs to notice that the bottom pill (or another tab) undid it, and
 * un-mark the rows it kept on screen as "done". Rendering the result is
 * the pill's job; this is bookkeeping.
 */
export type ActionReceipt = ActionReceiptResult & {
  /** Senders accepted into the action pipeline. */
  senderCount: number;
  senderName?: string;
  /** Original bulk selection, when different from accepted scope. */
  selectedCount?: number;
  /** Protected or no-longer-present senders skipped at enqueue time. */
  skippedCount?: number;
};
