/**
 * Storybook + test fixtures for the Autopilot screen (D104, D105).
 *
 * The shapes mirror `@/lib/api/autopilot` exactly so a story or a
 * test can feed the screen the same data the BE would. Sender keys are
 * realistic-looking sha256 hex digests (D7); we never embed the
 * underlying email in a fixture because the wire never carries it.
 */

import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';

const NOW = '2026-05-26T10:00:00.000Z';
const WEEK_AGO = '2026-05-19T10:00:00.000Z';
const TWO_DAYS_AGO = '2026-05-24T10:00:00.000Z';

export const AUTO_ARCHIVE_LOW_ENGAGEMENT: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000001',
  presetKey: 'auto_archive_low_engagement',
  isPreset: true,
  name: 'Auto-archive low-engagement',
  enabled: true,
  mode: 'observe',
  modeChangedAt: WEEK_AGO,
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

export const NEWSLETTER_GRAVEYARD: AutopilotRuleDto = {
  id: '00000000-0000-0000-0000-000000000002',
  presetKey: 'newsletter_graveyard',
  isPreset: true,
  name: 'Newsletter graveyard',
  enabled: true,
  mode: 'observe',
  modeChangedAt: WEEK_AGO,
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
  modeChangedAt: WEEK_AGO,
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

export const PRESET_RULES_ALL_PAUSED: AutopilotRuleDto[] = PRESET_RULES_OBSERVE.map((r) => ({
  ...r,
  mode: 'paused' as const,
  modeChangedAt: NOW,
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
