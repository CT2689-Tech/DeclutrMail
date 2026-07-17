// Storybook CSF3 stories for the bulk-action SelectionBar (D52, D210).
//
// The sticky bar appears while ≥1 sender is checked and offers the bulk
// K/A/U/L/D verbs (D227 canonical order). Per-verb eligibility counts are
// derived from the selection (`canArchive` / `canUnsubscribe` / …), so a
// protected or people sender greys out the verbs it can't take. These
// stories pin the bar chrome + the disabled/eligible/busy edge states so
// the design-system gate (D210) can catch regressions.

import type { ComponentProps } from 'react';
import { tokens } from '@declutrmail/shared';
import { SelectionBar } from './selection-bar';
import { makeSender } from './testing/make-sender';

const { color } = tokens;

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const meta: StoryMeta<typeof SelectionBar> = {
  title: 'Senders/SelectionBar',
  component: SelectionBar,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Sticky bulk-action bar (D52). Renders while ≥1 sender is selected; offers the bulk K/A/U/L/D verbs (D227) with per-verb eligible counts. Destructive verbs route through the mandatory D226 preview (owned by the host) — the bar only dispatches intent. `busy` disables every verb while a bulk enqueue is in flight so a slow round-trip cannot double-fire.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type BarArgs = ComponentProps<typeof SelectionBar>;

const noop = () => undefined;

const sender: typeof makeSender = (overrides = {}) =>
  makeSender({
    displayName: overrides.id ?? 'story-sender',
    domain: 'acme.com',
    gmailCategory: 'promotions',
    lastDays: 4,
    ...overrides,
  });

/** Standing-protection wire flags (D42/D43) for story-seed brevity. */
const PROTECTED = {
  isProtected: true,
  protectionReason: 'user_defined',
  protectionSetAt: '2026-06-01T00:00:00.000Z',
} as const;

/** Frame the bar against the page background so the dark pill reads correctly. */
function frame(args: BarArgs) {
  return (
    <div style={{ background: color.bg, padding: 24, maxWidth: 1180 }}>
      <SelectionBar {...args} />
    </div>
  );
}

/** Mixed selection — every verb eligible for at least one sender. */
export const MixedSelection: Story<typeof SelectionBar> = {
  args: {
    senders: [
      sender({ id: 'Acme Newsletter' }),
      sender({ id: 'Weekly Deals', domain: 'deals.com' }),
      sender({ id: 'Product Updates', domain: 'updates.io' }),
    ],
    onClear: noop,
    onAct: noop,
  },
  render: frame,
};

/** Single sender — the count copy reads "1 sender selected". */
export const SingleSelection: Story<typeof SelectionBar> = {
  args: {
    senders: [sender({ id: 'Acme Newsletter' })],
    onClear: noop,
    onAct: noop,
  },
  render: frame,
};

/**
 * All protected — every destructive verb greys out (eligible count 0);
 * only Keep (a non-destructive standing-policy write) stays live.
 */
export const AllProtected: Story<typeof SelectionBar> = {
  args: {
    senders: [
      sender({ id: 'Bank Statements', protectionFlags: PROTECTED }),
      sender({ id: 'Protected Client', protectionFlags: PROTECTED, gmailCategory: 'primary' }),
    ],
    onClear: noop,
    onAct: noop,
  },
  render: frame,
};

/**
 * People selected — Unsubscribe greys out (never applies to primary-group
 * senders) while Archive / Later / Delete stay eligible.
 */
export const PeopleSelected: Story<typeof SelectionBar> = {
  args: {
    senders: [
      sender({ id: 'Jane Doe', gmailCategory: 'primary', domain: 'gmail.com' }),
      sender({ id: 'John Smith', gmailCategory: 'primary', domain: 'outlook.com' }),
    ],
    onClear: noop,
    onAct: noop,
  },
  render: frame,
};

/** Busy — a bulk enqueue is in flight; every verb button is disabled. */
export const Busy: Story<typeof SelectionBar> = {
  args: {
    senders: [
      sender({ id: 'Acme Newsletter' }),
      sender({ id: 'Weekly Deals', domain: 'deals.com' }),
    ],
    onClear: noop,
    onAct: noop,
    busy: true,
  },
  render: frame,
};
