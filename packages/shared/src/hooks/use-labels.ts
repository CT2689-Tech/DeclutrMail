'use client';

import { useLocalState } from './use-local-state';

export type LabelKey =
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
    senders: 'People & lists',
    triage: 'Today',
    brief: 'Brief',
    followups: 'Follow-ups',
    snoozed: 'Snoozed',
    screener: 'Pending senders',
    quiet: 'Quiet hours',
    activity: 'History',
    autopilot: 'Rules',
    settings: 'Settings',
    billing: 'Billing',
  },
  power: {
    senders: 'Senders',
    triage: 'Triage',
    brief: 'Brief',
    followups: 'Follow-ups',
    snoozed: 'Snoozed',
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
