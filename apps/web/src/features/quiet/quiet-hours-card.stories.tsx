// Storybook CSF3 stories for the quiet-hours card (U18 — D92/D95).
//
// Same lightweight local CSF shims as the Autopilot/Triage stories —
// swap for `@storybook/react` imports when the Storybook seed lands;
// the story shapes do not change.
//
// Variants covered (per D211 edge-state inventory + Storybook contract):
//   • Unconfigured     — config null, defaults in the form
//   • Configured       — saved window, quiet NOT active now
//   • QuietNow         — saved window covering now ("Quiet now" pill)
//   • CrossesMidnight  — overnight window, "next day" hint visible
//   • Loading          — skeleton stack
//   • Error            — fetch failed branch with Retry
//   • Saving           — PUT in flight, form disabled
//   • Disconnected     — mailbox disconnected; config still editable

import type { ComponentProps } from 'react';
import { QuietHoursCard } from './quiet-hours-card';

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

const meta: StoryMeta<typeof QuietHoursCard> = {
  title: 'Quiet/QuietHoursCard',
  component: QuietHoursCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Per-mailbox quiet-hours config card (U18 — D92/D95). One recurring daily window (local start/end + IANA timezone + enabled). While the window covers now, Autopilot mutations defer and run after the window ends — manual K/A/U/L/D actions are never deferred. Windows may cross midnight (start > end). The "Quiet now" pill reports the SAME predicate the worker defers on.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof QuietHoursCard>;

const noop = () => undefined;

const baseArgs: CardArgs = {
  mailboxEmail: 'chintan.a.thakkar@gmail.com',
  mailboxStatus: 'active',
  state: { kind: 'ready', config: null, activeNow: false },
  saving: false,
  onSave: noop,
};

export const Unconfigured: Story<typeof QuietHoursCard> = {
  args: { ...baseArgs },
};

export const Configured: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    state: {
      kind: 'ready',
      config: { enabled: true, startLocal: '09:00', endLocal: '17:00', timezone: 'Asia/Kolkata' },
      activeNow: false,
    },
  },
};

export const QuietNow: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    state: {
      kind: 'ready',
      config: { enabled: true, startLocal: '00:00', endLocal: '23:59', timezone: 'Asia/Kolkata' },
      activeNow: true,
    },
  },
};

export const CrossesMidnight: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    state: {
      kind: 'ready',
      config: { enabled: true, startLocal: '22:00', endLocal: '06:00', timezone: 'Asia/Kolkata' },
      activeNow: false,
    },
  },
};

export const Loading: Story<typeof QuietHoursCard> = {
  args: { ...baseArgs, state: { kind: 'loading' } },
};

export const ErrorState: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    state: { kind: 'error', message: "We couldn't load quiet hours (HTTP 500)." },
    onRetry: noop,
  },
};

export const Saving: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    saving: true,
    state: {
      kind: 'ready',
      config: { enabled: true, startLocal: '22:00', endLocal: '06:00', timezone: 'Asia/Kolkata' },
      activeNow: false,
    },
  },
};

export const Disconnected: Story<typeof QuietHoursCard> = {
  args: {
    ...baseArgs,
    mailboxStatus: 'disconnected',
    state: {
      kind: 'ready',
      config: { enabled: true, startLocal: '22:00', endLocal: '06:00', timezone: 'Asia/Kolkata' },
      activeNow: false,
    },
  },
};
