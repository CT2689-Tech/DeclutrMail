'use client';

import {
  BILLING_NAME,
  BRIEF_NAME,
  NAV_GROUP_LABEL,
  SCREENER_NAME,
  TRIAGE_NAME,
} from '../copy/screen-decisions';
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

const SHARED_LABELS: LabelSet = {
  home: 'Home',
  senders: 'Senders',
  triage: TRIAGE_NAME,
  brief: BRIEF_NAME,
  followups: 'Follow-ups',
  snoozed: 'Later',
  screener: SCREENER_NAME,
  quiet: 'Quiet hours',
  activity: 'Activity',
  autopilot: 'Autopilot',
  settings: 'Settings',
  billing: BILLING_NAME,
};

const LABEL_SETS: Record<LabelMode, LabelSet> = {
  plain: SHARED_LABELS,
  power: SHARED_LABELS,
};

export const RETIRED_NAV_LABELS = [
  'People & lists',
  'Today',
  'Pending senders',
  'History',
  'Rules',
  'Daily brief',
  'Billing',
  'Clean up',
] as const;

export function labelSet(mode: LabelMode = 'power'): LabelSet {
  return LABEL_SETS[mode];
}

export const NAV_GROUP = NAV_GROUP_LABEL;

/** Power-user vs plain-language navigation labels (persisted choice). */
export function useLabels(): LabelSet {
  const [mode] = useLocalState<LabelMode>('labelMode', 'power');
  return LABEL_SETS[mode];
}
