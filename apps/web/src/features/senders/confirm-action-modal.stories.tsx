// Storybook CSF3 stories for the Senders confirm sheet (D226, ADR-0042).
//
// The mandatory preview before any Senders mutation, on the shared
// `PreviewSheet`: the count in the title, where the email goes in the
// subtitle, how to undo it in the note — each once — with only the
// supported scope/period controls in the body and other facts behind
// "Details". Same grammar as Triage's ActionSheet.

import type { ComponentProps } from 'react';
import type { CompositeActionPreviewResult } from '@/lib/api/use-action';
import { ConfirmActionModal } from './confirm-action-modal';
import { makeSender } from './testing/make-sender';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
};

const meta: StoryMeta<typeof ConfirmActionModal> = {
  title: 'Senders/ConfirmActionModal',
  component: ConfirmActionModal,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The Senders D226 preview on the shared PreviewSheet (ADR-0042). Title = count + verb as a question, subtitle = whose email and where it goes, note = how to undo it; supported reach / window / backlog choosers remain visible even when counts tie; everything else sits behind Details.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type Args = ComponentProps<typeof ConfirmActionModal>;

const noop = () => undefined;

const macys = makeSender({
  id: 'macys',
  displayName: 'Macy’s',
  email: 'news@macys.com',
  domain: 'macys.com',
  totalReceived: 2_140,
  monthlyVolume: 174,
  unsubscribeMethod: 'one_click',
});

const buckets = {
  all: 174,
  olderThan30d: 120,
  olderThan90d: 64,
  olderThan180d: 31,
  olderThan365d: 9,
};
const subjects = {
  all: [
    { subject: 'Flash sale ends tonight', date: '2026-09-19T15:00:00.000Z' },
    { subject: 'Your weekend picks', date: '2026-09-17T15:00:00.000Z' },
  ],
  olderThan30d: [{ subject: 'Summer clearance', date: '2026-08-10T15:00:00.000Z' }],
  olderThan90d: [],
  olderThan180d: [],
  olderThan365d: [],
};
const preview: CompositeActionPreviewResult = {
  sender: {
    id: macys.id,
    name: macys.name,
    domain: macys.domain,
    lastSeenDays: 2,
    wroteToCount: 0,
  },
  counts: buckets,
  recentMessages: subjects,
  allMail: {
    counts: {
      all: 1_980,
      olderThan30d: 1_900,
      olderThan90d: 1_700,
      olderThan180d: 1_400,
      olderThan365d: 900,
    },
    recentMessages: subjects,
  },
  unsubAvailable: true,
  protected: false,
};

const base = {
  onCancel: noop,
  onConfirm: noop,
  mailboxEmail: 'you@gmail.com',
} satisfies Partial<Args>;

/** Single sender, Archive — logo, "Archive 174 emails?", window chooser. */
export const ArchiveOneSender: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Archive', senders: [macys] },
    compositePreview: preview,
    cleanupQuota: { remaining: 34, resetsAt: null },
  } satisfies Args,
};

/** Delete — reach (Inbox only / Inbox + archived) and the 6-month default window. */
export const DeleteWithReach: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Delete', senders: [macys] },
    compositePreview: preview,
  } satisfies Args,
};

/** Unsubscribe — the backlog chooser; the note says a sent request can't be recalled. */
export const Unsubscribe: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Unsubscribe', senders: [macys] },
    compositePreview: preview,
  } satisfies Args,
};

/** Zero — "Nothing in your inbox from …", confirm disabled. */
export const NothingInInbox: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Archive', senders: [macys] },
    compositePreview: {
      ...preview,
      counts: { all: 0, olderThan30d: 0, olderThan90d: 0, olderThan180d: 0, olderThan365d: 0 },
      allMail: null,
    },
  } satisfies Args,
};

const bulkSenders = [
  macys,
  makeSender({ id: 'nike', displayName: 'Nike', email: 'hi@nike.com', domain: 'nike.com' }),
  makeSender({ id: 'uber', displayName: 'Uber', email: 'news@uber.com', domain: 'uber.com' }),
  makeSender({ id: 'etsy', displayName: 'Etsy', email: 'hi@etsy.com', domain: 'etsy.com' }),
];

/** Bulk Delete — avatar stack, eligible count in the title, the skipped Protected sender in the note. */
export const BulkDelete: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: {
      verb: 'Delete',
      senders: bulkSenders,
      selectedCount: 5,
      skipped: { protectedCount: 1, peopleCount: 0 },
    },
    bulkPreview: {
      loading: false,
      error: false,
      data: {
        senders: bulkSenders.map((s) => ({
          senderId: s.id,
          name: s.name,
          counts: buckets,
          protected: false,
        })),
        totals: {
          all: 696,
          olderThan30d: 480,
          olderThan90d: 256,
          olderThan180d: 124,
          olderThan365d: 36,
        },
        protectedCount: 0,
      },
    },
  } satisfies Args,
};

/** The request is on its way — "Submitting…", Cancel stays live. */
export const Submitting: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Archive', senders: [macys] },
    compositePreview: preview,
    submitting: true,
  } satisfies Args,
};

/** The preview failed — confirm locked, one way out. */
export const PreviewFailed: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Archive', senders: [macys] },
    compositePreviewError: true,
    onRetryPreview: noop,
  } satisfies Args,
};

/** All messages are old; equal counts still leave time and scope editable. */
export const EqualCountChoices: Story<typeof ConfirmActionModal> = {
  args: {
    ...base,
    request: { verb: 'Delete', senders: [macys] },
    compositePreview: {
      ...preview,
      counts: { all: 7, olderThan30d: 7, olderThan90d: 7, olderThan180d: 7, olderThan365d: 7 },
      allMail: {
        counts: { all: 7, olderThan30d: 7, olderThan90d: 7, olderThan180d: 7, olderThan365d: 7 },
        recentMessages: {
          all: [],
          olderThan30d: [],
          olderThan90d: [],
          olderThan180d: [],
          olderThan365d: [],
        },
      },
    },
  } satisfies Args,
};
