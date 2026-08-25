// Storybook CSF3 stories for the D64 Brief-schedule card
// (Settings → Notifications). Local CSF shims per the existing pattern.
//
// Variants covered (per D211 edge-state inventory + Storybook contract):
//   • Default      — 8am local, the D64 default
//   • CustomHour   — a user who moved the Brief to the evening
//   • Midnight     — the 12:00 AM edge, where the label is easiest to
//                    get wrong (hour 0 must not read "0:00 AM")
//   • NoTimezone   — zone not yet captured; copy must not claim one
//   • Saving       — PATCH in flight, select disabled
//   • SaveFailed   — PATCH failed, inline alert
//   • Loading      — settings read in flight
//   • Error        — settings read failed, retry affordance

import type { ComponentProps } from 'react';
import { BriefPrefsCard } from './brief-prefs-card';

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

const meta: StoryMeta<typeof BriefPrefsCard> = {
  title: 'Settings/BriefPrefsCard',
  component: BriefPrefsCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Settings → Notifications (D64). The Daily Brief's local delivery hour. The Brief covers the previous day and generates every day — D66's weekday-only schedule was retired because it meant Saturday's Brief never ran, leaving Friday's mail summarized by nothing. Slots are hourly rather than D64's \"any 30-min slot\": generation is an hourly cron, so a half-hour choice would silently round up. Persisted under users.preferences.briefPrefs; the BriefSnapshotWorker reads the same key at generation time.",
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof BriefPrefsCard>;

const noop = () => undefined;

const baseArgs: CardArgs = {
  state: { kind: 'ready', prefs: { hour: 8 } },
  timezone: 'America/Los_Angeles',
  pending: false,
  saveFailed: false,
  onChange: noop,
};

export const Default: Story<typeof BriefPrefsCard> = {
  args: baseArgs,
};

export const CustomHour: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'ready', prefs: { hour: 18 } }, timezone: 'Asia/Kolkata' },
};

export const Midnight: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'ready', prefs: { hour: 0 } } },
};

export const NoTimezone: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, timezone: null },
};

export const Saving: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, pending: true },
};

export const SaveFailed: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, saveFailed: true },
};

export const Loading: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'loading' } },
};

export const Error: Story<typeof BriefPrefsCard> = {
  args: { ...baseArgs, state: { kind: 'error', onRetry: noop } },
};
