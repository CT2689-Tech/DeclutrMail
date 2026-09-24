'use client';

import { useLocalState } from './use-local-state';

export type LabelKey =
  | 'home'
  | 'senders'
  | 'triage'
  | 'brief'
  | 'followups'
  | 'snoozed'
  | 'screener'
  | 'quiet'
  | 'activity'
  | 'autopilot'
  | 'settings'
  | 'billing';

export type LabelSet = Record<LabelKey, string>;
export type LabelMode = 'plain' | 'power';

const LABEL_SETS: Record<LabelMode, LabelSet> = {
  plain: {
    home: 'Home',
    senders: 'People & lists',
    triage: 'Today',
    brief: 'Brief',
    followups: 'Follow-ups',
    snoozed: 'Later',
    screener: 'Pending senders',
    quiet: 'Quiet hours',
    activity: 'History',
    autopilot: 'Rules',
    settings: 'Settings',
    billing: 'Billing',
  },
  power: {
    home: 'Home',
    senders: 'Senders',
    triage: 'Triage',
    brief: 'Brief',
    followups: 'Follow-ups',
    snoozed: 'Later',
    screener: 'Screener',
    quiet: 'Quiet',
    activity: 'Activity',
    autopilot: 'Autopilot',
    settings: 'Settings',
    billing: 'Billing',
  },
};

/** Power-user vs plain-language navigation labels (persisted choice). */
export function useLabels(): LabelSet {
  const [mode] = useLocalState<LabelMode>('labelMode', 'power');
  return LABEL_SETS[mode];
}
