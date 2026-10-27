import { getFixSet } from '@declutrmail/shared/inbox-report';
import type { SnoozedSenderRow } from '@declutrmail/shared/contracts';

import type { HomeState } from './home-state';

/** Closed set for `home_next_step_clicked`. Order is the card rank. */
export const HOME_NEXT_STEP_KINDS = ['unsub_archive', 'largest', 'later_due'] as const;

export type HomeNextStepKind = (typeof HOME_NEXT_STEP_KINDS)[number];

export interface HomeSenderIdentity {
  id: string;
  name: string;
  domain: string;
  brandMark?: boolean;
  inboxCount?: number | null;
  readRate?: number | null;
}

/** The displayed shortlist and the preview always address the same verified senders. */
export function homeShortlist(senders: readonly HomeSenderIdentity[]): HomeFixCandidate | null {
  const current = senders
    .filter(
      (sender) =>
        typeof sender.inboxCount === 'number' &&
        Number.isFinite(sender.inboxCount) &&
        sender.inboxCount > 0,
    )
    .slice(0, 3);
  if (current.length === 0) return null;
  return {
    kind: 'unsub_archive',
    senderCount: current.length,
    senderIds: current.map((sender) => sender.id),
    emailCount: current.reduce((total, sender) => total + sender.inboxCount!, 0),
    senders: current,
  };
}

export interface HomeFixCandidate {
  kind: HomeNextStepKind;
  senderCount: number;
  emailCount?: number;
  sizeLabel?: string;
  senderIds: readonly string[];
  senderName?: string;
  senders?: readonly HomeSenderIdentity[];
}

export type HomeV1Mode = 'full' | 'fallback' | 'empty' | 'sync-failed' | 'loading' | 'error';

const RANK = new Map<HomeNextStepKind, number>(
  HOME_NEXT_STEP_KINDS.map((kind, index) => [kind, index]),
);

/**
 * 1 primary + up to 2 secondary. Largest is omitted until F2's size view
 * is on. A zero sender count is not a card.
 */
export function rankHomeNextSteps(
  candidates: readonly HomeFixCandidate[],
  options: { senderSizeView: boolean },
): HomeFixCandidate[] {
  return candidates
    .filter((candidate) => candidate.senderCount > 0)
    .filter((candidate) => options.senderSizeView || candidate.kind !== 'largest')
    .slice()
    .sort((a, b) => (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99))
    .slice(0, 3);
}

/** Only due or troubled timers, never future scheduled mail. A missing clock is unknown. */
export function homeLaterCandidate(
  rows: readonly Pick<SnoozedSenderRow, 'senderId' | 'snoozedUntil' | 'returnStatus'>[],
  now: number | null,
): HomeFixCandidate | null {
  const due = rows.filter(
    (row) =>
      row.returnStatus === 'missed' ||
      row.returnStatus === 'retrying' ||
      (now !== null && Date.parse(row.snoozedUntil) <= now),
  );
  if (due.length === 0) return null;
  return {
    kind: 'later_due',
    senderCount: due.length,
    senderIds: due.map((row) => row.senderId),
  };
}

/** Unsubscribe step from a report. No report means no step. Later is not in this set. */
export function homeCandidatesFromReport(
  report: Parameters<typeof getFixSet>[0] | null,
): HomeFixCandidate[] {
  if (report === null) return [];
  const fix = getFixSet(report);
  if (fix.sendersCount < 1 || fix.senderKeys.length === 0) return [];
  return [
    {
      kind: 'unsub_archive',
      senderCount: fix.sendersCount,
      emailCount: fix.inboxEmailCount,
      senderIds: fix.senderKeys,
    },
  ];
}

export function homeV1Mode(kind: HomeState['kind'], stepCount: number): HomeV1Mode {
  switch (kind) {
    case 'loading':
    case 'error':
    case 'empty':
    case 'sync-failed':
      return kind;
    case 'ready':
      return stepCount > 0 ? 'full' : 'fallback';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** "Review N today" is never Home's primary action. */
export function isRetiredReviewCta(label: string): boolean {
  return /^Review [\d,]+ (today|new)$/.test(label);
}
