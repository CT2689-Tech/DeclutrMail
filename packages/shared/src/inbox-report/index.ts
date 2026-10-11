/** Share card stays off until it is explicitly switched on. */
export function isInboxReportShareEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_INBOX_REPORT_SHARE_ENABLED ?? env.INBOX_REPORT_SHARE_ENABLED;
  return raw === '1' || raw === 'true';
}

/** Read-only size-by-sender stays off until the launch switch. */
export function isSenderSizeViewEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.NEXT_PUBLIC_SENDER_SIZE_VIEW ?? env.SENDER_SIZE_VIEW;
  return raw === '1' || raw === 'true';
}

export {
  INBOX_REPORT_PRIORITY,
  INBOX_REPORT_THRESHOLDS,
  type InboxReportInsightId,
} from './thresholds';
export {
  formatReportSize,
  getFixSet,
  reportFallback,
  reportGlyph,
  reportHeadline,
  reportSupport,
} from './present';
export type { ReportHeadline } from './present';
export {
  isReportableInternalDate,
  mailboxSizeBucket,
  selectFixSet,
  selectInboxReport,
} from './select';
export type {
  InboxReportDto,
  InboxReportFix,
  InboxReportInsight,
  MailboxSizeBucket,
  ReportFacts,
  ReportSenderFacts,
} from './types';
