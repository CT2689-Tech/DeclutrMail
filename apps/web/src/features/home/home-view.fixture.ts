/** Synthetic data for stories and the development-only Home preview. */
import type { HomeOverview } from './api/use-home-overview';
import type { InboxReportDto } from '@declutrmail/shared/inbox-report';
export const overviewFixture: HomeOverview = {
  snapshot: {
    status: 'ready',
    data: {
      asOf: '2026-10-25T20:00:00Z',
      inboxCount: 6200,
      unreadInboxCount: 1000,
      receivedCount: 40000,
      totalBytes: 4200000000,
      sizeKnownCount: 39900,
    },
  },
  week: {
    status: 'ready',
    data: {
      since: '2026-10-20T12:00:00Z',
      decidedSenders: 10,
      emailsByVerb: { archive: 800, delete: 200 },
    },
  },
  rules: { status: 'ready', data: { active: 2, watching: 1, paused: 0 } },
  suggestions: { status: 'ready', data: 83 },
  followups: { status: 'ready', data: 2 },
  brief: { status: 'ready', data: { opened: false } },
  recent: { status: 'ready', data: null },
};
export const reportFixture: InboxReportDto = {
  generatedAt: '2026-10-25T20:00:00Z',
  mailboxSizeBucket: '1_to_5gb',
  insights: [
    { id: 'large_mail', bytes: 1400000000, count: 121, top10Bytes: 1000000000 },
    { id: 'mostly_unread_share', pct: 88, senderCount: 120, sweeperExcluded: 0, window: '90d' },
  ],
  fix: { senderKeys: ['a', 'b', 'c'], sendersCount: 3, inboxEmailCount: 2400 },
  fallbackSenderCount: 40,
  receivedCount: 40000,
  totalBytes: 4200000000,
  variant: 'full',
};
