/**
 * Domain owner: report: WS5.
 *
 * Append new report events here. Do not rename existing events.
 */
export const REPORT_EVENT_NAMES = [
  'unsub_backlog_choice_shown',
  'unsub_backlog_confirmed',
  'report_viewed',
  'report_fix_clicked',
  'share_card_created',
] as const;

export type ReportEventName = (typeof REPORT_EVENT_NAMES)[number];

export type UnsubscribeBacklogMode = 'unsub_only' | 'archive' | 'delete';

/**
 * Counts and modes only. No sender names, addresses, subjects, or snippets.
 */
export interface ReportEventPayloads {
  unsub_backlog_choice_shown: {
    mode_default: UnsubscribeBacklogMode;
    sender_count: number;
    email_count: number;
  };
  unsub_backlog_confirmed: {
    mode: UnsubscribeBacklogMode;
    sender_count: number;
    email_count: number;
  };
  report_viewed: {
    variant: 'insights' | 'fallback';
    insight_count: number;
  };
  report_fix_clicked: {
    sender_count: number;
  };
  share_card_created: {
    theme: 'light' | 'dark';
  };
}
