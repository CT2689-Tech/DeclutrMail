import type { GmailCategory } from '@declutrmail/shared/contracts';

import type { Me } from '@/features/auth/api/me-contract';
import type { ProtectionReasonWire, UnsubscribeMethod } from '@/lib/api/senders';

/**
 * Made-up mailbox behind the public Senders demo. Every name and address
 * is invented and every domain ends in `.example`, which cannot be
 * registered.
 */

/** Email ages in days. Each sender holds a count of email at each age. */
export const DEMO_AGES = [12, 45, 120, 240, 420] as const;
export type DemoBuckets = [number, number, number, number, number];

export interface DemoSenderSeed {
  id: string;
  name: string;
  email: string;
  category: GmailCategory;
  lastSeenDays: number;
  firstSeenMonths: number;
  received90d: number;
  totalReceived: number;
  /** Share of the last 90 days marked read, 0–100. */
  readPct: number;
  wroteTo: number;
  protection: ProtectionReasonWire | null;
  unsubscribe: UnsubscribeMethod;
  subjects: readonly [string, string, string];
  inbox: DemoBuckets;
  archived: DemoBuckets;
  /** The sample suggestion shown in Guided Review and the detail pane. */
  suggestion: { verdict: 'keep' | 'archive' | 'unsubscribe' | 'later'; reasoning: string };
}

export const DEMO_MAILBOX_ID = 'demo-mailbox';

export const DEMO_ME: Me = {
  user: {
    id: 'demo-user',
    email: 'you@sample-inbox.example',
    workspaceId: 'demo-workspace',
    timezone: null,
  },
  mailboxes: [
    {
      id: DEMO_MAILBOX_ID,
      email: 'you@sample-inbox.example',
      status: 'active',
      connectedAt: null,
      readiness: 'ready',
      needsReconnect: false,
    },
  ],
  activeMailboxId: DEMO_MAILBOX_ID,
  tier: 'plus',
  cleanupRemaining: null,
};

export const DEMO_SENDERS: readonly DemoSenderSeed[] = [
  {
    id: 'market',
    name: 'Market Finds',
    email: 'offers@market.example',
    category: 'promotions',
    lastSeenDays: 1,
    firstSeenMonths: 30,
    received90d: 83,
    totalReceived: 652,
    readPct: 5,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['A deal picked for you', 'Last chance this week', 'Your saved items'],
    inbox: [41, 37, 34, 52, 27],
    archived: [9, 13, 28, 79, 98],
    suggestion: { verdict: 'unsubscribe', reasoning: 'Sample: 5% marked read in 90 days.' },
  },
  {
    id: 'northstar',
    name: 'Northstar Weekly',
    email: 'hello@northstar.example',
    category: 'promotions',
    lastSeenDays: 2,
    firstSeenMonths: 26,
    received90d: 46,
    totalReceived: 389,
    readPct: 18,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['Your Sunday reading list', 'What changed this week', 'A note from our editors'],
    inbox: [26, 22, 18, 31, 14],
    archived: [12, 19, 21, 48, 62],
    suggestion: { verdict: 'unsubscribe', reasoning: 'Sample: 18% marked read in 90 days.' },
  },
  {
    id: 'loop',
    name: 'Loop Fitness',
    email: 'club@loopfitness.example',
    category: 'promotions',
    lastSeenDays: 4,
    firstSeenMonths: 14,
    received90d: 31,
    totalReceived: 244,
    readPct: 22,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['This week’s class schedule', 'Your streak is waiting', 'Member offer inside'],
    inbox: [14, 12, 17, 9, 6],
    archived: [5, 11, 19, 33, 41],
    suggestion: { verdict: 'archive', reasoning: 'Sample: 22% marked read in 90 days.' },
  },
  {
    id: 'receipts',
    name: 'Parcel Receipts',
    email: 'receipts@parcel.example',
    category: 'updates',
    lastSeenDays: 3,
    firstSeenMonths: 40,
    received90d: 14,
    totalReceived: 218,
    readPct: 89,
    wroteTo: 2,
    protection: 'starred',
    unsubscribe: 'none',
    subjects: ['Your order receipt', 'Delivery update', 'Order confirmation'],
    inbox: [3, 4, 5, 2, 1],
    archived: [8, 13, 22, 37, 44],
    suggestion: { verdict: 'keep', reasoning: 'Sample: you starred an email from them.' },
  },
  {
    id: 'trail',
    name: 'Trail Journal',
    email: 'stories@trail.example',
    category: 'promotions',
    lastSeenDays: 6,
    firstSeenMonths: 20,
    received90d: 21,
    totalReceived: 174,
    readPct: 72,
    wroteTo: 1,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['A route for the weekend', 'Gear notes', 'The long way home'],
    inbox: [9, 7, 12, 8, 4],
    archived: [7, 18, 24, 39, 46],
    suggestion: { verdict: 'keep', reasoning: 'Sample: 72% marked read in 90 days.' },
  },
  {
    id: 'harbor',
    name: 'Harbor Forum Digest',
    email: 'digest@harborforum.example',
    category: 'forums',
    lastSeenDays: 5,
    firstSeenMonths: 18,
    received90d: 26,
    totalReceived: 163,
    readPct: 12,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'mailto',
    subjects: ['New replies in your threads', 'Weekly forum digest', 'A topic you follow'],
    inbox: [11, 9, 13, 10, 5],
    archived: [4, 8, 17, 28, 35],
    suggestion: { verdict: 'archive', reasoning: 'Sample: 12% marked read in 90 days.' },
  },
  {
    id: 'maya',
    name: 'Maya Okafor',
    email: 'maya@okafor-family.example',
    category: 'primary',
    lastSeenDays: 0,
    firstSeenMonths: 48,
    received90d: 19,
    totalReceived: 131,
    readPct: 100,
    wroteTo: 6,
    protection: 'replied',
    unsubscribe: 'none',
    subjects: ['Photos from Saturday', 'Re: dinner next week', 'Fwd: the recipe'],
    inbox: [5, 3, 2, 1, 0],
    archived: [6, 14, 21, 30, 38],
    suggestion: { verdict: 'keep', reasoning: 'Sample: you wrote to them 6 times.' },
  },
  {
    id: 'cedar',
    name: 'Cedar Bank Alerts',
    email: 'alerts@cedarbank.example',
    category: 'updates',
    lastSeenDays: 8,
    firstSeenMonths: 36,
    received90d: 12,
    totalReceived: 122,
    readPct: 64,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'none',
    subjects: ['Your statement is ready', 'Sign-in from a new device', 'Payment received'],
    inbox: [4, 3, 6, 4, 2],
    archived: [3, 9, 15, 26, 31],
    suggestion: { verdict: 'keep', reasoning: 'Sample: 64% marked read in 90 days.' },
  },
  {
    id: 'studio',
    name: 'Studio Dispatch',
    email: 'dispatch@studio.example',
    category: 'promotions',
    lastSeenDays: 45,
    firstSeenMonths: 16,
    received90d: 6,
    totalReceived: 96,
    readPct: 28,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['Spring notes', 'A new collection', 'From the studio'],
    inbox: [0, 5, 7, 8, 6],
    archived: [0, 4, 10, 22, 29],
    suggestion: { verdict: 'archive', reasoning: 'Sample: 28% marked read in 90 days.' },
  },
  {
    id: 'catalog',
    name: 'Catalog Club',
    email: 'news@catalog.example',
    category: 'promotions',
    lastSeenDays: 240,
    firstSeenMonths: 28,
    received90d: 0,
    totalReceived: 141,
    readPct: 12,
    wroteTo: 0,
    protection: null,
    unsubscribe: 'one_click',
    subjects: ['A note from last season', 'Your member update', 'New in store'],
    inbox: [0, 0, 0, 11, 13],
    archived: [0, 0, 0, 33, 58],
    suggestion: { verdict: 'archive', reasoning: 'Sample: no email from them in 240 days.' },
  },
];
