// Storybook CSF3 stories for the D165 notification-preferences card
// (Settings → Notifications). Local CSF shims per the existing pattern.
//
// Variants covered (per D211 edge-state inventory + Storybook contract):
//   • Defaults     — every category on (D165 default)
//   • OptedOut     — both toggleable categories off; system row stays
//                    "Always on" (non-opt-out per CAN-SPAM/GDPR)
//   • Saving       — one toggle's PATCH in flight
//   • SaveFailed   — PATCH failed, inline alert
//   • Loading      — settings read in flight
//   • Error        — settings read failed, retry affordance

import type { ComponentProps } from 'react';
import { EmailPrefsCard } from './email-prefs-card';

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

const meta: StoryMeta<typeof EmailPrefsCard> = {
  title: 'Settings/EmailPrefsCard',
  component: EmailPrefsCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Notifications (D165). Per-category email toggles — sync completion alerts + reminder emails — with the non-opt-out system row (account/deletion notices) rendered as "Always on" instead of a fake toggle. Persisted under users.preferences.emailPrefs; the EmailSendWorker reads the same key at send time.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof EmailPrefsCard>;

const noop = () => undefined;

const baseArgs: CardArgs = {
  state: { kind: 'ready', prefs: { reminders: true, syncComplete: true } },
  pendingWire: null,
  saveFailed: false,
  onToggle: noop,
};

export const Defaults: Story<typeof EmailPrefsCard> = {
  args: baseArgs,
};

export const OptedOut: Story<typeof EmailPrefsCard> = {
  args: {
    ...baseArgs,
    state: { kind: 'ready', prefs: { reminders: false, syncComplete: false } },
  },
};

export const Saving: Story<typeof EmailPrefsCard> = {
  args: { ...baseArgs, pendingWire: 'syncComplete' },
};

export const SaveFailed: Story<typeof EmailPrefsCard> = {
  args: { ...baseArgs, saveFailed: true },
};

export const Loading: Story<typeof EmailPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'loading' } },
};

export const Error: Story<typeof EmailPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'error', onRetry: noop } },
};
