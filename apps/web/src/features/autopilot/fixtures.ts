/**
 * Storybook + test fixtures for the Autopilot screen (D99–D105).
 *
 * The shapes mirror `@/lib/api/autopilot` exactly so a story or a
 * test can feed the screen the same data the BE would. Sender keys are
 * realistic-looking sha256 hex digests (D7); we never embed the
 * underlying email in a fixture because the wire never carries it.
 */

import type {
  AutopilotMatchDto,
  AutopilotRuleDto,
  AutopilotRulePreviewResultDto,
} from '@/lib/api/autopilot';

const NOW = '2026-05-26T10:00:00.000Z';
const WEEK_AGO = '2026-05-19T10:00:00.000Z';
const TWO_DAYS_AGO = '2026-05-24T10:00:00.000Z';
/** Mid-window — 2 days into the 7-day observe window. */
const IN_FIVE_DAYS = '2026-05-31T10:00:00.000Z';

export const AUTO_ARCHIVE_LOW_ENGAGEMENT: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000001',
  presetKey: 'auto_archive_low_engagement',
  isPreset: true,
  name: 'Auto-archive low-engagement',
  enabled: true,
  mode: 'observe',
  modeChangedAt: WEEK_AGO,
  // Window ended NOW − 7h… the seed week elapsed: WEEK_AGO + 7d = NOW.
  observeWindowEndsAt: NOW,
  observeWindowElapsed: true,
  observePromptDismissedAt: null,
  observeDigest: { pendingTotal: 34, senders7d: 34, messages7d: 212 },
  confidenceThreshold: 0.7,
  scope: 'account',
  actionKind: 'archive',
  actionPayload: {},
  lastRunAt: TWO_DAYS_AGO,
  lastRunActions: 14,
  lastRunSenders: 7,
  createdAt: WEEK_AGO,
  updatedAt: TWO_DAYS_AGO,
};

export const AUTO_UNSUBSCRIBE_NOISY: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000004',
  presetKey: 'auto_unsubscribe_noisy',
  isPreset: true,
  name: 'Auto-unsubscribe noisy senders',
  enabled: true,
  mode: 'observe',
  modeChangedAt: TWO_DAYS_AGO,
  observeWindowEndsAt: IN_FIVE_DAYS,
  observeWindowElapsed: false,
  observePromptDismissedAt: null,
  observeDigest: { pendingTotal: 3, senders7d: 2, messages7d: 11 },
  confidenceThreshold: 0.9,
  scope: 'account',
  actionKind: 'unsubscribe',
  actionPayload: {},
  lastRunAt: TWO_DAYS_AGO,
  lastRunActions: 2,
  lastRunSenders: 2,
  createdAt: WEEK_AGO,
  updatedAt: TWO_DAYS_AGO,
};

export const NEWSLETTER_GRAVEYARD: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000002',
  presetKey: 'newsletter_graveyard',
  isPreset: true,
  name: 'Newsletter graveyard',
  enabled: true,
  mode: 'observe',
  modeChangedAt: TWO_DAYS_AGO,
  observeWindowEndsAt: IN_FIVE_DAYS,
  observeWindowElapsed: false,
  observePromptDismissedAt: null,
  observeDigest: { pendingTotal: 5, senders7d: 3, messages7d: 9 },
  confidenceThreshold: null,
  scope: 'account',
  actionKind: 'unsubscribe',
  actionPayload: {},
  lastRunAt: TWO_DAYS_AGO,
  lastRunActions: 3,
  lastRunSenders: 3,
  createdAt: WEEK_AGO,
  updatedAt: TWO_DAYS_AGO,
};

export const LONG_DORMANT_UNSUBSCRIBE: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000005',
  presetKey: 'long_dormant_unsubscribe',
  isPreset: true,
  name: 'Long-dormant unsubscribe',
  enabled: false,
  mode: 'observe',
  modeChangedAt: TWO_DAYS_AGO,
  observeWindowEndsAt: IN_FIVE_DAYS,
  observeWindowElapsed: false,
  observePromptDismissedAt: null,
  observeDigest: { pendingTotal: 0, senders7d: 0, messages7d: 0 },
  confidenceThreshold: null,
  scope: 'account',
  actionKind: 'unsubscribe',
  actionPayload: {},
  lastRunAt: null,
  lastRunActions: 0,
  lastRunSenders: 0,
  createdAt: WEEK_AGO,
  updatedAt: TWO_DAYS_AGO,
};

export const SCREEN_NEW_SENDERS: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000003',
  presetKey: 'auto_screen_new_senders',
  isPreset: true,
  // Mirrors the BE seed (D101 #3) which ships with the banned "Screen"
  // word in its default-name. The UI substitutes the canonical Later
  // label via `presetDisplayName` so D227 stays clean without an
  // immediate BE rename. Tracked in FOUNDER-FOLLOWUPS.md.
  name: 'Auto-screen new senders',
  enabled: true,
  mode: 'observe',
  modeChangedAt: TWO_DAYS_AGO,
  observeWindowEndsAt: IN_FIVE_DAYS,
  observeWindowElapsed: false,
  observePromptDismissedAt: null,
  observeDigest: { pendingTotal: 1, senders7d: 1, messages7d: 2 },
  confidenceThreshold: null,
  scope: 'account',
  actionKind: 'later',
  actionPayload: {},
  lastRunAt: null,
  lastRunActions: 0,
  lastRunSenders: 0,
  createdAt: WEEK_AGO,
  updatedAt: WEEK_AGO,
};

export const PRESET_RULES_OBSERVE: AutopilotRuleDto[] = [
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  NEWSLETTER_GRAVEYARD,
  SCREEN_NEW_SENDERS,
];

/** All five launch presets (D101 + D124) — drives the rules-management list. */
export const PRESET_RULES_ALL_FIVE: AutopilotRuleDto[] = [
  AUTO_ARCHIVE_LOW_ENGAGEMENT,
  AUTO_UNSUBSCRIBE_NOISY,
  SCREEN_NEW_SENDERS,
  NEWSLETTER_GRAVEYARD,
  LONG_DORMANT_UNSUBSCRIBE,
];

export const PRESET_RULES_ALL_PAUSED: AutopilotRuleDto[] = PRESET_RULES_OBSERVE.map((r) => ({
  ...r,
  mode: 'paused' as const,
  modeChangedAt: NOW,
  observeWindowEndsAt: null,
  observeWindowElapsed: false,
  // Digest is an Observe-mode surface — null outside Observe (BE contract).
  observeDigest: null,
}));

export const PENDING_SUGGESTIONS: AutopilotMatchDto[] = [
  {
    id: '00000000-0000-0000-0000-0000000000a1',
    ruleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
    senderKey: 'a1b2c3d4e5f607080910111213141516171819202122232425262728293031ff',
    senderName: 'Bargain Bulletin',
    senderEmail: 'noreply@bargainbulletin.example',
    matchedAt: TWO_DAYS_AGO,
    modeAtMatch: 'observe',
    confidence: 0.92,
    reason: 'monthly_volume=47, read_rate=0.04',
    resolution: 'pending',
    intentApplied: false,
    intentToken: null,
    resolvedAt: null,
  },
  {
    id: '00000000-0000-0000-0000-0000000000a2',
    ruleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
    senderKey: 'b2c3d4e5f60708091011121314151617181920212223242526272829303132aa',
    senderName: 'Quarterly Recap',
    senderEmail: 'team@quarterly-recap.example',
    matchedAt: TWO_DAYS_AGO,
    modeAtMatch: 'observe',
    confidence: 0.78,
    reason: 'monthly_volume=12, read_rate=0.08',
    resolution: 'pending',
    intentApplied: false,
    intentToken: null,
    resolvedAt: null,
  },
  {
    id: '00000000-0000-0000-0000-0000000000a3',
    ruleId: NEWSLETTER_GRAVEYARD.id,
    // Race-window example — senders index hasn't materialised this row
    // yet. The FE row falls back to the senderKey hash for these.
    senderKey: 'c3d4e5f60708091011121314151617181920212223242526272829303132aabb',
    senderName: null,
    senderEmail: null,
    matchedAt: WEEK_AGO,
    modeAtMatch: 'observe',
    confidence: 0.81,
    reason: 'last_seen=42d, read_rate=0.00',
    resolution: 'pending',
    intentApplied: false,
    intentToken: null,
    resolvedAt: null,
  },
];

/** Dry-run preview result for the auto-archive preset (D103/D192). */
export const RULE_PREVIEW_RESULT: AutopilotRulePreviewResultDto = {
  ruleId: AUTO_ARCHIVE_LOW_ENGAGEMENT.id,
  wouldMatchCount: 12,
  actionableSenderCount: 10,
  actionableMessageCount: 74,
  protectedWouldMatchCount: 3,
  evaluatedSenders: 148,
  dailyActionCap: 100,
  weeklyVolume: {
    observedMatches: 34,
    observedDays: 7,
    estimatedMatches: 34,
    basis: 'observed_7d',
  },
  sample: [
    {
      senderKey: 'a1b2c3d4e5f607080910111213141516171819202122232425262728293031ff',
      senderName: 'Bargain Bulletin',
      senderEmail: 'noreply@bargainbulletin.example',
      reason: 'Read rate 4%, 47 msgs/mo',
    },
    {
      senderKey: 'b2c3d4e5f60708091011121314151617181920212223242526272829303132aa',
      senderName: 'Quarterly Recap',
      senderEmail: 'team@quarterly-recap.example',
      reason: 'Read rate 8%, 12 msgs/mo',
    },
    {
      senderKey: 'c3d4e5f60708091011121314151617181920212223242526272829303132aabb',
      senderName: null,
      senderEmail: null,
      reason: 'Read rate 0%, last seen 42d ago',
    },
  ],
};
