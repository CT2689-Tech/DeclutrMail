/**
 * Query params the Senders screen writes to the page URL: its filters,
 * search and sort, the open sender, and a guided-review token. The
 * simulator drops them when the visitor leaves the Senders workspace.
 */
export const SENDERS_DEMO_URL_KEYS = [
  'activity',
  'unsub_ready',
  'wrote-to',
  'protected',
  'window',
  'domain',
  'unsub_ignored',
  'has_inbox_mail',
  'mostly_unread',
  'q',
  'sort',
  'direction',
  'sender',
  'review',
] as const;
