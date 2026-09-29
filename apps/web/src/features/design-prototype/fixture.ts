import type { useSenderWorkspace } from './sender-workspace';
/** Synthetic, memory-only design fixtures. Never connect this prototype to Gmail. */
export type PrototypeView = 'overview' | 'senders' | 'website';
export type PrototypeVariant = 'editorial' | 'precision';
export type PrototypeAction = 'Keep' | 'Archive' | 'Unsubscribe' | 'Later' | 'Delete';
export type PrototypeTheme = 'light' | 'dark';

export interface SampleSender {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  inbox: number;
  total: number;
  recent: number;
  markedRead: number;
  firstSeen: string;
  lastSeen: string;
  protected: boolean;
  reason: string;
  trend: number[];
  messages: { subject: string; date: string; snippet: string }[];
}

export const sampleSenders: [SampleSender, ...SampleSender[]] = [
  {
    id: 'fieldnotes',
    name: 'Fieldnotes',
    email: 'weekly@fieldnotes.example',
    initials: 'fn',
    color: '#8b4e32',
    inbox: 128,
    total: 412,
    recent: 46,
    markedRead: 8,
    firstSeen: 'March 2023',
    lastSeen: 'Today',
    protected: false,
    reason: '128 emails in your inbox · 8% marked read in the last 90 days',
    trend: [8, 11, 9, 14, 12, 19, 16, 22, 19, 25, 22, 28],
    messages: [
      {
        subject: 'Small ideas for a slower Sunday',
        date: 'Today',
        snippet: 'A few things worth making room for this week.',
      },
      {
        subject: 'The art of doing a little less',
        date: 'Sep 18',
        snippet: 'On finding more space in an ordinary day.',
      },
      {
        subject: 'A collection of good things',
        date: 'Sep 14',
        snippet: 'Our weekly collection of places, people and ideas.',
      },
    ],
  },
  {
    id: 'orbit',
    name: 'Orbit',
    email: 'updates@orbit.example',
    initials: 'o',
    color: '#5e649d',
    inbox: 96,
    total: 286,
    recent: 38,
    markedRead: 12,
    firstSeen: 'June 2024',
    lastSeen: 'Yesterday',
    protected: false,
    reason: '96 emails in your inbox · 12% marked read in the last 90 days',
    trend: [8, 12, 7, 8, 12, 16, 10, 11, 16, 15, 13, 10],
    messages: [
      {
        subject: 'Your weekly workspace roundup',
        date: 'Yesterday',
        snippet: 'Here is what happened across your workspace.',
      },
      {
        subject: 'A few updates you may have missed',
        date: 'Sep 17',
        snippet: 'New additions to your workspace this week.',
      },
      {
        subject: 'A new week, a clearer view',
        date: 'Sep 10',
        snippet: 'Your latest notifications in one place.',
      },
    ],
  },
  {
    id: 'wayfinder',
    name: 'Wayfinder',
    email: 'hello@wayfinder.example',
    initials: 'w',
    color: '#426b5c',
    inbox: 74,
    total: 198,
    recent: 28,
    markedRead: 18,
    firstSeen: 'January 2024',
    lastSeen: 'Today',
    protected: false,
    reason: '74 emails in your inbox · last received today',
    trend: [4, 7, 8, 5, 9, 6, 10, 8, 11, 9, 12, 8],
    messages: [
      {
        subject: 'Somewhere new for your next weekend',
        date: 'Today',
        snippet: 'A handful of places to put on your list.',
      },
      {
        subject: 'Take the scenic route',
        date: 'Sep 16',
        snippet: 'A fresh collection of weekend escapes.',
      },
      {
        subject: 'Your September travel notes',
        date: 'Sep 12',
        snippet: 'Ideas for a change of scenery.',
      },
    ],
  },
  {
    id: 'northbank',
    name: 'Northbank',
    email: 'alerts@northbank.example',
    initials: 'N',
    color: '#305775',
    inbox: 42,
    total: 324,
    recent: 24,
    markedRead: 88,
    firstSeen: 'October 2022',
    lastSeen: 'Yesterday',
    protected: true,
    reason: 'Protected by you · excluded from bulk cleanup and automation',
    trend: [6, 7, 5, 7, 8, 6, 5, 8, 6, 9, 7, 8],
    messages: [
      {
        subject: 'Your monthly statement is ready',
        date: 'Yesterday',
        snippet: 'Your latest account statement is available.',
      },
      {
        subject: 'Your account notification',
        date: 'Sep 15',
        snippet: 'An update is available in your account.',
      },
      {
        subject: 'September account summary',
        date: 'Sep 11',
        snippet: 'View your account summary securely.',
      },
    ],
  },
  {
    id: 'studio',
    name: 'Studio North',
    email: 'journal@studionorth.example',
    initials: 'sn',
    color: '#947333',
    inbox: 61,
    total: 173,
    recent: 22,
    markedRead: 21,
    firstSeen: 'April 2024',
    lastSeen: 'Sep 19',
    protected: false,
    reason: '61 emails in your inbox · 21% marked read in the last 90 days',
    trend: [4, 6, 5, 8, 6, 9, 7, 10, 8, 7, 9, 6],
    messages: [
      {
        subject: 'Objects for everyday living',
        date: 'Sep 19',
        snippet: 'Our latest edit of thoughtfully made essentials.',
      },
      {
        subject: 'The September journal',
        date: 'Sep 12',
        snippet: 'A closer look at the people behind the pieces.',
      },
      {
        subject: 'New in the studio',
        date: 'Sep 5',
        snippet: 'Materials, details and things in progress.',
      },
    ],
  },
  {
    id: 'parcel',
    name: 'Parcel',
    email: 'news@parcel.example',
    initials: 'p',
    color: '#b26742',
    inbox: 53,
    total: 139,
    recent: 19,
    markedRead: 16,
    firstSeen: 'August 2024',
    lastSeen: 'Sep 18',
    protected: false,
    reason: '53 emails in your inbox · last received Sep 18',
    trend: [2, 3, 5, 4, 6, 5, 7, 9, 5, 8, 7, 6],
    messages: [
      {
        subject: 'A little something for your home',
        date: 'Sep 18',
        snippet: 'This week’s collection has arrived.',
      },
      {
        subject: 'The weekend edit',
        date: 'Sep 13',
        snippet: 'Discover the latest from independent makers.',
      },
      {
        subject: 'Meet the makers',
        date: 'Sep 6',
        snippet: 'The stories behind this month’s collection.',
      },
    ],
  },
];

export interface PrototypeProps {
  workspace: ReturnType<typeof useSenderWorkspace>;
  view: PrototypeView;
  theme: PrototypeTheme;
  senders: SampleSender[];
  selected: SampleSender;
  cleared: number;
  lastResult: string | null;
  navigate: (view: PrototypeView) => void;
  selectSender: (id: string) => void;
  previewAction: (action: PrototypeAction) => void;
  toggleProtection: () => void;
  openFullDetails: () => void;
  fullDetails: boolean;
  showInfo: (title: string, description: string) => void;
}
