import type { InboxReportInsightId } from './thresholds';

export type MailboxSizeBucket = 'under_1gb' | '1_to_5gb' | '5_to_15gb' | 'over_15gb';

export type InboxReportInsight =
  | {
      id: 'mostly_unread_share';
      pct: number;
      senderCount: number;
      sweeperExcluded: number;
      window: '90d';
    }
  | { id: 'people_share'; pct: number }
  | { id: 'large_mail'; bytes: number; count: number; top10Bytes: number }
  | {
      id: 'third_party_labels';
      count: number;
      bytes: number;
      recent90: number;
      vendorKey: string;
    }
  | { id: 'years_deep'; oldestYear: number; olderPct: number }
  | { id: 'top10_share'; pct: number }
  | { id: 'trash_bytes'; bytes: number; count: number };

export interface InboxReportFix {
  /** Sender ids the Senders screen already uses. */
  senderKeys: string[];
  sendersCount: number;
  inboxEmailCount: number;
}

export interface InboxReportDto {
  generatedAt: string;
  mailboxSizeBucket: MailboxSizeBucket;
  insights: InboxReportInsight[];
  fix: InboxReportFix;
  /** Worth-a-look senders before the cap. Fallback copy uses this as {k}. */
  fallbackSenderCount: number;
  /** Inbound messages on or after 1995. Fallback copy uses this as {total}. */
  receivedCount: number;
  /** All inbound size estimates on or after 1995. Aggregates only. */
  totalBytes: number;
  variant: 'full' | 'fallback';
}

export interface ReportSenderFacts {
  senderId: string;
  inbound90: number;
  markedRead90: number;
  sweeperMarked90: number;
  hasUnsubscribe: boolean;
  wroteToCount: number;
  isProtected: boolean;
  isKeep: boolean;
  inboxCount: number;
}

/** Aggregates the selector needs. The service computes these; it does not rank. */
export interface ReportFacts {
  receivedCount: number;
  receivedBytes: number;
  inbound90: number;
  markedRead90: number;
  peopleReceived: number;
  largeCount: number;
  largeBytes: number;
  top10Bytes: number;
  thirdPartyCount: number;
  thirdPartyBytes: number;
  thirdPartyRecent90: number;
  vendorKey: string | null;
  oldestYear: number | null;
  olderThan3YearsCount: number;
  top10Count: number;
  trashCount: number;
  trashBytes: number;
  senders: ReportSenderFacts[];
  nowYear: number;
}

export type { InboxReportInsightId };
