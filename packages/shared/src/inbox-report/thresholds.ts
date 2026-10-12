/**
 * Inbox Report thresholds. Every cutoff the selector uses lives here so a
 * boundary test can name the constant it is sitting on.
 *
 * Byte cutoffs are decimal GB (1 GB = 1_000_000_000 bytes), matching the
 * "GB" the report sentences use.
 */
export const INBOX_REPORT_THRESHOLDS = {
  /** Senders need at least this many inbound messages in the window. */
  mostlyUnreadMinMessages: 3,
  /** A sender is "mostly unread" below this marked-read share. */
  mostlyUnreadMaxReadRate: 0.1,
  /** The insight is eligible at or above this share of 90-day inbound. */
  mostlyUnreadMinShare: 0.4,
  /** Suppressed when the mailbox's own 90-day marked-read share is above this. */
  mostlyUnreadSuppressionReadRate: 0.8,
  /** people_share is eligible at or below this share. */
  peopleShareMax: 0.15,
  /** large_mail counts a message at or above this size. */
  largeMessageBytes: 5_000_000,
  /** large_mail is eligible at or above this total. */
  largeMailMinBytes: 1_000_000_000,
  /** third_party_labels is eligible at or above this message count. */
  thirdPartyMinEmails: 500,
  /** trash_bytes is eligible at or above this total. */
  trashMinBytes: 250_000_000,
  /** years_deep is eligible when the oldest year is at most this many years back. */
  yearsDeepMinAge: 8,
  /** Messages before this year are excluded from every received fact. */
  minReportableYear: 1995,
  /** top10_share is eligible at or above this share of received mail. */
  top10MinShare: 0.3,
  /** Fix-set cap. */
  fixSetCap: 50,
  engineWindowDays: 90,
} as const;

/** Fixed rank. The first eligible wins the headline; the selector returns three. */
export const INBOX_REPORT_PRIORITY = [
  'third_party_labels',
  'mostly_unread_share',
  'large_mail',
  'people_share',
  'years_deep',
  'trash_bytes',
  'top10_share',
] as const;

export type InboxReportInsightId = (typeof INBOX_REPORT_PRIORITY)[number];
