import {
  selectInboxReport,
  type InboxReportDto,
  type ReportFacts,
} from '@declutrmail/shared/inbox-report';

/** Sample mailbox totals the sender rows do not carry. Aggregates only. */
const SAMPLE_LARGE_MAIL_BYTES = 1_200_000_000;
const SAMPLE_LARGE_MAIL_COUNT = 12;
const SAMPLE_PEOPLE_RECEIVED = 80;

export interface SampleReportSender {
  id: string;
  received90d: number;
  totalReceived: number;
  /** Marked-read share for the last 90 days, 0–100, matching the sample row. */
  markedReadPct: number;
  wroteTo: number;
  protected: boolean;
  unsubscribe: 'one_click' | 'mailto' | 'none';
  inboxCount: number;
  kept?: boolean;
}

function markedReadCount(sender: SampleReportSender): number {
  return Math.round((sender.markedReadPct / 100) * sender.received90d);
}

/** Inbox Report for the public simulator. Selection uses the product function. */
export function sampleInboxReport(
  senders: readonly SampleReportSender[],
  generatedAt = '2026-10-11T00:00:00.000Z',
): InboxReportDto {
  const receivedCount = senders.reduce((sum, sender) => sum + sender.totalReceived, 0);
  const inbound90 = senders.reduce((sum, sender) => sum + sender.received90d, 0);
  const markedRead90 = senders.reduce((sum, sender) => sum + markedReadCount(sender), 0);
  const facts: ReportFacts = {
    receivedCount,
    receivedBytes: SAMPLE_LARGE_MAIL_BYTES,
    inbound90,
    markedRead90,
    peopleReceived: SAMPLE_PEOPLE_RECEIVED,
    largeCount: SAMPLE_LARGE_MAIL_COUNT,
    largeBytes: SAMPLE_LARGE_MAIL_BYTES,
    top10Bytes: 800_000_000,
    thirdPartyCount: 0,
    thirdPartyBytes: 0,
    thirdPartyRecent90: 0,
    vendorKey: null,
    oldestYear: null,
    olderThan3YearsCount: 0,
    top10Count: 0,
    trashCount: 0,
    trashBytes: 0,
    nowYear: 2026,
    senders: senders.map((sender) => ({
      senderId: sender.id,
      inbound90: sender.received90d,
      markedRead90: markedReadCount(sender),
      sweeperMarked90: 0,
      hasUnsubscribe: sender.unsubscribe === 'one_click' || sender.unsubscribe === 'mailto',
      wroteToCount: sender.wroteTo,
      isProtected: sender.protected,
      isKeep: sender.kept === true,
      handledByBacklog: false,
      inboxCount: sender.inboxCount,
    })),
  };
  return selectInboxReport(facts, generatedAt);
}
