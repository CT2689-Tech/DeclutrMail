import { fillCopy, isPluralCopy, pluralCopy, WS5_COPY } from '../copy/launch';
import { sweeperDisplayName } from '../senders/sweeper-labels';
import type { InboxReportDto, InboxReportInsight } from './types';

export interface ReportHeadline {
  figure: string | null;
  sentence: string;
}

/** Decimal MB under 1 GB, otherwise GB to one decimal. */
export function formatReportSize(bytes: number): string {
  if (bytes < 1_000_000_000) {
    const mb = bytes / 1_000_000;
    const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
    return `${rounded} MB`;
  }
  const gb = Math.round((bytes / 1_000_000_000) * 10) / 10;
  return `${gb} GB`;
}

export function reportGlyph(pct: number): { n: number; label: string } | null {
  if (pct < 40) return null;
  const n = Math.round(pct / 10);
  return { n, label: fillCopy(WS5_COPY['report.glyph'], { n }) };
}

/** Deck strings stay as written. Counts are formatted before they fill `{count}`, `{n}`, `{k}`, or `{total}`. */
function reportCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function reportHeadline(insight: InboxReportInsight): ReportHeadline {
  switch (insight.id) {
    case 'mostly_unread_share': {
      if (insight.pct >= 100) {
        return {
          figure: null,
          sentence: fillCopy(WS5_COPY['report.mostlyUnread.headline.all'], {
            n: reportCount(insight.senderCount),
          }),
        };
      }
      const copy = WS5_COPY['report.mostlyUnread.headline'];
      const sentence = isPluralCopy(copy)
        ? pluralCopy(copy, insight.senderCount, {
            pct: insight.pct,
            n: reportCount(insight.senderCount),
          })
        : '';
      const figure = `${insight.pct}%`;
      return { figure, sentence };
    }
    case 'people_share':
      return {
        figure: `${insight.pct}%`,
        sentence: fillCopy(WS5_COPY['report.people'], { pct: insight.pct }),
      };
    case 'large_mail': {
      const copy = WS5_COPY['report.largeMail'];
      const sentence = isPluralCopy(copy)
        ? pluralCopy(copy, insight.count, {
            size: formatReportSize(insight.bytes),
            count: reportCount(insight.count),
          })
        : '';
      return { figure: null, sentence };
    }
    case 'third_party_labels': {
      const copy = WS5_COPY['report.thirdParty'];
      const sentence = isPluralCopy(copy)
        ? pluralCopy(copy, insight.count, {
            count: reportCount(insight.count),
            size: formatReportSize(insight.bytes),
            Vendor: sweeperDisplayName(insight.vendorKey),
          })
        : '';
      return { figure: null, sentence };
    }
    case 'years_deep':
      return {
        figure: String(insight.oldestYear),
        sentence: fillCopy(WS5_COPY['report.yearsDeep'], {
          year: insight.oldestYear,
          pct: insight.olderPct,
        }),
      };
    case 'top10_share':
      return {
        figure: `${insight.pct}%`,
        sentence: fillCopy(WS5_COPY['report.top10'], { pct: insight.pct }),
      };
    case 'trash_bytes':
      return {
        figure: null,
        sentence: fillCopy(WS5_COPY['report.trash'], { size: formatReportSize(insight.bytes) }),
      };
    default: {
      const never: never = insight;
      return never;
    }
  }
}

export function reportSupport(insight: InboxReportInsight): string | null {
  if (insight.id === 'mostly_unread_share') {
    const copy = WS5_COPY['report.mostlyUnread.support'];
    return isPluralCopy(copy) ? pluralCopy(copy, insight.senderCount) : null;
  }
  return null;
}

export function reportFallback(
  report: Pick<InboxReportDto, 'receivedCount' | 'fallbackSenderCount'>,
): {
  body: string;
  cta: string | null;
} {
  if (report.fallbackSenderCount === 0) {
    return {
      body: fillCopy(WS5_COPY['report.fallback.zero'], {
        total: reportCount(report.receivedCount),
      }),
      cta: null,
    };
  }
  const bodyCopy = WS5_COPY['report.fallback'];
  const ctaCopy = WS5_COPY['report.fallback.cta'];
  return {
    body: isPluralCopy(bodyCopy)
      ? pluralCopy(bodyCopy, report.fallbackSenderCount, {
          total: reportCount(report.receivedCount),
          k: reportCount(report.fallbackSenderCount),
        })
      : '',
    cta: isPluralCopy(ctaCopy)
      ? pluralCopy(ctaCopy, report.fallbackSenderCount, {
          k: reportCount(report.fallbackSenderCount),
        })
      : null,
  };
}

export function getFixSet(report: InboxReportDto): {
  senderKeys: string[];
  sendersCount: number;
  inboxEmailCount: number;
} {
  return {
    senderKeys: report.fix.senderKeys,
    sendersCount: report.fix.sendersCount,
    inboxEmailCount: report.fix.inboxEmailCount,
  };
}
