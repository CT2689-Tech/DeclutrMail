import {
  INBOX_REPORT_PRIORITY,
  INBOX_REPORT_THRESHOLDS,
  type InboxReportInsightId,
} from './thresholds';
import type { InboxReportDto, InboxReportInsight, ReportFacts, ReportSenderFacts } from './types';

const T = INBOX_REPORT_THRESHOLDS;

/** Epoch and pre-1995 rows are not mail the report talks about. */
export function isReportableInternalDate(value: Date): boolean {
  return value.getUTCFullYear() >= T.minReportableYear;
}

export function mailboxSizeBucket(bytes: number): InboxReportDto['mailboxSizeBucket'] {
  if (bytes < 1_000_000_000) return 'under_1gb';
  if (bytes < 5_000_000_000) return '1_to_5gb';
  if (bytes < 15_000_000_000) return '5_to_15gb';
  return 'over_15gb';
}

function share(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return part / whole;
}

function roundedPct(ratio: number): number {
  return Math.round(ratio * 100);
}

function mostlyUnread(sender: ReportSenderFacts): boolean {
  if (sender.inbound90 < T.mostlyUnreadMinMessages) return false;
  return sender.markedRead90 / sender.inbound90 < T.mostlyUnreadMaxReadRate;
}

/** The fix set: mostly-unread senders with an unsubscribe channel, exclusions applied. */
export function selectFixSet(facts: ReportFacts): InboxReportDto['fix'] & {
  fallbackSenderCount: number;
} {
  const eligible = facts.senders
    .filter(
      (sender) =>
        sender.hasUnsubscribe &&
        mostlyUnread(sender) &&
        !sender.isProtected &&
        sender.wroteToCount <= 0 &&
        !sender.isKeep &&
        !sender.handledByBacklog,
    )
    .sort((a, b) => b.inboxCount - a.inboxCount || a.senderId.localeCompare(b.senderId));
  const capped = eligible.slice(0, T.fixSetCap);
  return {
    senderKeys: capped.map((sender) => sender.senderId),
    sendersCount: capped.length,
    inboxEmailCount: capped.reduce((sum, sender) => sum + sender.inboxCount, 0),
    fallbackSenderCount: eligible.length,
  };
}

function buildInsight(id: InboxReportInsightId, facts: ReportFacts): InboxReportInsight | null {
  switch (id) {
    case 'mostly_unread_share': {
      const overall = share(facts.markedRead90, facts.inbound90);
      if (overall !== null && overall > T.mostlyUnreadSuppressionReadRate) return null;
      const qualifying = facts.senders.filter(mostlyUnread);
      const fromThem = qualifying.reduce((sum, sender) => sum + sender.inbound90, 0);
      const ratio = share(fromThem, facts.inbound90);
      if (ratio === null || ratio < T.mostlyUnreadMinShare) return null;
      return {
        id,
        pct: roundedPct(ratio),
        senderCount: qualifying.length,
        sweeperExcluded: qualifying.reduce((sum, sender) => sum + sender.sweeperMarked90, 0),
        window: '90d',
      };
    }
    case 'people_share': {
      const ratio = share(facts.peopleReceived, facts.receivedCount);
      if (ratio === null || ratio > T.peopleShareMax) return null;
      return { id, pct: roundedPct(ratio) };
    }
    case 'large_mail': {
      if (facts.largeBytes < T.largeMailMinBytes) return null;
      return {
        id,
        bytes: facts.largeBytes,
        count: facts.largeCount,
        top10Bytes: facts.top10Bytes,
      };
    }
    case 'third_party_labels': {
      if (facts.thirdPartyCount < T.thirdPartyMinEmails || facts.vendorKey === null) return null;
      return {
        id,
        count: facts.thirdPartyCount,
        bytes: facts.thirdPartyBytes,
        recent90: facts.thirdPartyRecent90,
        vendorKey: facts.vendorKey,
      };
    }
    case 'years_deep': {
      if (facts.oldestYear === null) return null;
      if (facts.oldestYear > facts.nowYear - T.yearsDeepMinAge) return null;
      const ratio = share(facts.olderThan3YearsCount, facts.receivedCount);
      if (ratio === null) return null;
      return { id, oldestYear: facts.oldestYear, olderPct: roundedPct(ratio) };
    }
    case 'trash_bytes': {
      if (facts.trashBytes < T.trashMinBytes) return null;
      return { id, bytes: facts.trashBytes, count: facts.trashCount };
    }
    case 'top10_share': {
      const ratio = share(facts.top10Count, facts.receivedCount);
      if (ratio === null || ratio < T.top10MinShare) return null;
      return { id, pct: roundedPct(ratio) };
    }
    default: {
      const never: never = id;
      return never;
    }
  }
}

/** Rank eligible insights and pick the variant. Fewer than two qualifiers is the calm fallback. */
export function selectInboxReport(facts: ReportFacts, generatedAt: string): InboxReportDto {
  const ranked = INBOX_REPORT_PRIORITY.map((id) => buildInsight(id, facts)).filter(
    (insight): insight is InboxReportInsight => insight !== null,
  );
  const fix = selectFixSet(facts);
  return {
    generatedAt,
    mailboxSizeBucket: mailboxSizeBucket(facts.receivedBytes),
    insights: ranked.slice(0, 3),
    fix: {
      senderKeys: fix.senderKeys,
      sendersCount: fix.sendersCount,
      inboxEmailCount: fix.inboxEmailCount,
    },
    fallbackSenderCount: fix.fallbackSenderCount,
    receivedCount: facts.receivedCount,
    totalBytes: facts.receivedBytes,
    variant: ranked.length >= 2 ? 'full' : 'fallback',
  };
}
