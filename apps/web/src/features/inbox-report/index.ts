'use client';

import type { JSX } from 'react';

/**
 * Signature matches WS5 (`getFixSet(report)`, `InboxReportCard` with a
 * mailbox id). One module file, so a later merge does not keep both
 * `index.ts` and `index.tsx`. The card stays empty until that report lands.
 */
export function InboxReportCard(_props: {
  surface: 'home';
  mailboxId: string;
}): JSX.Element | null {
  return null;
}

export interface InboxReportFix {
  senderKeys: readonly string[];
  sendersCount: number;
  inboxEmailCount: number;
}

/** The report object Home can pass. WS5's `InboxReportDto` has this `fix`. */
export interface InboxReportSource {
  fix: InboxReportFix;
}

export function getFixSet(report: InboxReportSource): {
  senderKeys: string[];
  sendersCount: number;
  inboxEmailCount: number;
} {
  return {
    senderKeys: [...report.fix.senderKeys],
    sendersCount: report.fix.sendersCount,
    inboxEmailCount: report.fix.inboxEmailCount,
  };
}
