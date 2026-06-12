// Storybook CSF3 stories for the D34 action-preferences card (U23).
//
// Same lightweight local CSF shims as the Quiet/Autopilot stories —
// swap for `@storybook/react` imports when the Storybook seed lands.
//
// Variants covered (per D211 edge-state inventory + Storybook contract):
//   • Defaults      — every verb shows the sheet (D34 default)
//   • SkipsEnabled  — Unsubscribe + Later opted into the inline path
//   • Saving        — one toggle's PATCH in flight
//   • SaveFailed    — PATCH failed, inline alert
//   • Loading       — settings read in flight
//   • Error         — settings read failed, retry affordance

import type { ComponentProps } from 'react';
import { ActionSheetPrefsCard } from './action-sheet-prefs-card';

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

const meta: StoryMeta<typeof ActionSheetPrefsCard> = {
  title: 'Settings/ActionSheetPrefsCard',
  component: ActionSheetPrefsCard,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'Settings → Action preferences (D34). Per-verb "skip the action sheet" toggles for Archive / Unsubscribe / Later. The action preview is NEVER skippable (D226) — the card copy states this explicitly. Persisted under users.preferences.actionSheetPrefs so the choice roams devices.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

type CardArgs = ComponentProps<typeof ActionSheetPrefsCard>;

const noop = () => undefined;

const baseArgs: CardArgs = {
  state: {
    kind: 'ready',
    prefs: { archive: false, unsubscribe: false, later: false },
  },
  onToggle: noop,
  pendingWire: null,
  saveFailed: false,
};

export const Defaults: Story<typeof ActionSheetPrefsCard> = {
  args: baseArgs,
};

export const SkipsEnabled: Story<typeof ActionSheetPrefsCard> = {
  args: {
    ...baseArgs,
    state: {
      kind: 'ready',
      prefs: { archive: false, unsubscribe: true, later: true },
    },
  },
};

export const Saving: Story<typeof ActionSheetPrefsCard> = {
  args: {
    ...baseArgs,
    pendingWire: 'archive',
  },
};

export const SaveFailed: Story<typeof ActionSheetPrefsCard> = {
  args: {
    ...baseArgs,
    saveFailed: true,
  },
};

export const Loading: Story<typeof ActionSheetPrefsCard> = {
  args: {
    ...baseArgs,
    state: { kind: 'loading' },
  },
};

export const ErrorState: Story<typeof ActionSheetPrefsCard> = {
  args: {
    ...baseArgs,
    state: { kind: 'error', onRetry: noop },
  },
};
