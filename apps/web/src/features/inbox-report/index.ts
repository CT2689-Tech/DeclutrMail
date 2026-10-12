import type { InboxReportDto } from '@declutrmail/shared/inbox-report';
import { getFixSet as fixSetOf } from '@declutrmail/shared/inbox-report';

export { InboxReportFirstLanding } from './first-landing-entry';
export { InboxReportCard } from './card';

export function getFixSet(report: InboxReportDto): {
  senderKeys: string[];
  sendersCount: number;
  inboxEmailCount: number;
} {
  return fixSetOf(report);
}
