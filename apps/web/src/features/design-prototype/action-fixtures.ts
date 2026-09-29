/** Synthetic mail ledger. No network or provider identifiers exist in this model. */
import type { ConfirmOptions } from '@/features/senders/confirm-action-modal';
import { enrichSenderRow, type Sender } from '@/features/senders/data';
import type { CompositeActionPreviewResult } from '@/lib/api/actions';
import { sampleSenders, type PrototypeAction, type SampleSender } from './fixture';

export const SAMPLE_NOW = Date.parse('2026-09-21T12:00:00.000Z');
const DAY = 86_400_000;
export interface SampleMail {
  id: string;
  senderId: string;
  subject: string;
  date: string;
  location: 'inbox' | 'archived' | 'later' | 'trash';
}

function sampleMessageDate(label: string): string {
  const age = label === 'Today' ? 0 : label === 'Yesterday' ? 1 : null;
  return new Date(
    age === null ? Date.parse(`${label}, 2026 12:00:00 GMT`) : SAMPLE_NOW - age * DAY,
  ).toISOString();
}

/** Inbox counts match the visible fixture. Archived samples are a bounded separate
 * working set, NOT totalReceived minus inbox: lifetime received is historical evidence. */
export function initialSampleMail(): SampleMail[] {
  return sampleSenders.flatMap((sender) => {
    const inbox = Array.from({ length: sender.inbox }, (_, index): SampleMail => {
      const recent = sender.messages[index];
      const age = 20 + ((index * 17) % 520);
      const date = recent
        ? sampleMessageDate(recent.date)
        : new Date(SAMPLE_NOW - age * DAY).toISOString();
      return {
        id: `${sender.id}-inbox-${index}`,
        senderId: sender.id,
        subject: recent?.subject ?? `${sender.name} · Update ${date.slice(0, 10)}`,
        date,
        location: 'inbox',
      };
    });
    const archived = Array.from({ length: 18 }, (_, index): SampleMail => {
      const date = new Date(SAMPLE_NOW - (45 + index * 27) * DAY).toISOString();
      return {
        id: `${sender.id}-archived-${index}`,
        senderId: sender.id,
        subject: `${sender.name} · Archived update ${date.slice(0, 10)}`,
        date,
        location: 'archived',
      };
    });
    return [...inbox, ...archived];
  });
}

export function toActionSender(sender: SampleSender): Sender {
  const firstSeenAt = new Date(`${sender.firstSeen} 1 12:00:00 GMT`).toISOString();
  return enrichSenderRow(
    {
      id: sender.id,
      displayName: sender.name,
      email: sender.email,
      domain: sender.email.split('@')[1] ?? 'sample.example',
      brandMark: false,
      gmailCategory: 'promotions',
      lastSeenAt: sampleMessageDate(sender.lastSeen),
      firstSeenAt,
      totalReceived: sender.total,
      inboxCount: sender.inbox,
      wroteToCount: 0,
      monthlyVolume: sender.recent,
      readRate: sender.markedRead / 100,
      volumeTrend: 'steady',
      sparkline: sender.trend,
      unsubscribeMethod: 'one_click',
      lastReview: null,
      protectionFlags: {
        isProtected: sender.protected,
        protectionReason: sender.protected ? 'user_defined' : null,
        protectionSetAt: sender.protected ? new Date(SAMPLE_NOW).toISOString() : null,
      },
      policyType: null,
      unsubStatus: null,
    },
    SAMPLE_NOW,
  );
}

function olderThan(row: SampleMail, days: number | null): boolean {
  return days === null || Date.parse(row.date) < SAMPLE_NOW - days * DAY;
}

function previewScope(rows: SampleMail[]): NonNullable<CompositeActionPreviewResult['allMail']> {
  const windows = {
    all: null,
    olderThan30d: 30,
    olderThan90d: 90,
    olderThan180d: 180,
    olderThan365d: 365,
  } as const;
  const counts: CompositeActionPreviewResult['counts'] = {
    all: 0,
    olderThan30d: 0,
    olderThan90d: 0,
    olderThan180d: 0,
    olderThan365d: 0,
  };
  const recentMessages: CompositeActionPreviewResult['recentMessages'] = {
    all: [],
    olderThan30d: [],
    olderThan90d: [],
    olderThan180d: [],
    olderThan365d: [],
  };
  for (const key of Object.keys(windows) as (keyof typeof windows)[]) {
    const matching = rows
      .filter((row) => olderThan(row, windows[key]))
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    counts[key] = matching.length;
    recentMessages[key] = matching.slice(0, 5).map(({ subject, date }) => ({ subject, date }));
  }
  return { counts, recentMessages };
}

export function buildSamplePreview(
  sender: SampleSender,
  mail: SampleMail[],
): CompositeActionPreviewResult {
  const current = mail.filter((row) => row.senderId === sender.id);
  const adapted = toActionSender(sender);
  return {
    sender: {
      id: sender.id,
      name: sender.name,
      domain: adapted.domain,
      lastSeenDays: adapted.lastDays,
      wroteToCount: 0,
    },
    ...previewScope(current.filter((row) => row.location === 'inbox')),
    allMail: previewScope(current.filter((row) => row.location !== 'trash')),
    unsubAvailable: true,
    protected: sender.protected,
  };
}

export function countSampleInbox(mail: SampleMail[], senderId: string): number {
  return mail.filter((row) => row.senderId === senderId && row.location === 'inbox').length;
}

export function applySampleAction(
  mail: SampleMail[],
  senderId: string,
  action: PrototypeAction,
  options: ConfirmOptions,
): {
  mail: SampleMail[];
  affected: SampleMail[];
  inboxAffected: number;
  cleanupAction: 'Archive' | 'Delete' | 'Later' | null;
  unsubscribeRequested: boolean;
} {
  const secondary = action === 'Unsubscribe' ? options.secondary : null;
  const cleanupAction =
    action === 'Archive' || action === 'Delete' || action === 'Later'
      ? action
      : secondary?.type === 'archive'
        ? 'Archive'
        : secondary?.type === 'delete'
          ? 'Delete'
          : null;
  const defaultAge = action === 'Delete' ? 180 : null;
  const primaryAge = options.olderThanDays === undefined ? defaultAge : options.olderThanDays;
  const age =
    action === 'Later'
      ? null
      : secondary
        ? secondary.olderThanDays === undefined
          ? primaryAge
          : secondary.olderThanDays
        : primaryAge;
  // Production all_mail includes Later-labelled mail as well as inbox/archive.
  // Only Delete may use this reach; trash never matches.
  const includeAllMail = cleanupAction === 'Delete' && options.reach === 'all_mail';
  const affected =
    cleanupAction === null
      ? []
      : mail.filter(
          (row) =>
            row.senderId === senderId &&
            (row.location === 'inbox' || (includeAllMail && row.location !== 'trash')) &&
            olderThan(row, age),
        );
  const ids = new Set(affected.map((row) => row.id));
  const location: SampleMail['location'] =
    cleanupAction === 'Delete' ? 'trash' : cleanupAction === 'Later' ? 'later' : 'archived';
  return {
    mail: mail.map((row) => (ids.has(row.id) ? { ...row, location } : row)),
    affected: affected.map((row) => ({ ...row })),
    inboxAffected: affected.filter((row) => row.location === 'inbox').length,
    cleanupAction,
    unsubscribeRequested: action === 'Unsubscribe',
  };
}

/** Restore exactly the saved records, preserving all unrelated simulated work. */
export function restoreSampleMail(current: SampleMail[], affected: SampleMail[]): SampleMail[] {
  const originals = new Map(affected.map((row) => [row.id, row]));
  return current.map((row) => (originals.has(row.id) ? { ...originals.get(row.id)! } : row));
}
