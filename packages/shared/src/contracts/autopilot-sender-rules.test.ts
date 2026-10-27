import { describe, expect, it } from 'vitest';
import {
  AutopilotSenderRuleCreateSchema,
  AutopilotSenderRulePatchSchema,
  AutopilotSenderRulePreviewRequestSchema,
} from './autopilot-sender-rules';

const rule = {
  name: 'Weekend reading',
  senderKeys: ['a'.repeat(64)],
  action: 'archive',
  reach: 'inbox_only',
  olderThanDays: 90,
};
describe('explicit sender-rule contracts', () => {
  it('accepts bounded metadata rules and trims their name', () => {
    expect(AutopilotSenderRuleCreateSchema.parse({ ...rule, name: '  Reading  ' }).name).toBe(
      'Reading',
    );
  });
  it('rejects archive outside Inbox, empty selection, duplicate and unbounded senders', () => {
    for (const invalid of [
      { ...rule, reach: 'all_mail' },
      { ...rule, senderKeys: [] },
      { ...rule, senderKeys: [rule.senderKeys[0], rule.senderKeys[0]] },
      {
        ...rule,
        senderKeys: Array.from({ length: 101 }, (_, i) => i.toString(16).padStart(64, '0')),
      },
      { ...rule, olderThanDays: -1 },
      { ...rule, prompt: 'delete everything' },
    ])
      expect(AutopilotSenderRuleCreateSchema.safeParse(invalid).success).toBe(false);
  });
  it('requires a positive version and never permits unattended Active', () => {
    expect(AutopilotSenderRulePatchSchema.safeParse({ version: 1, mode: 'paused' }).success).toBe(
      true,
    );
    expect(AutopilotSenderRulePatchSchema.safeParse({ ...rule, version: 1 }).success).toBe(true);
    for (const invalid of [
      { ...rule },
      { version: 0, mode: 'observe' },
      { version: 1, mode: 'active' },
    ]) {
      expect(AutopilotSenderRulePatchSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it('accepts per-cleanup overrides and refuses client message identifiers', () => {
    expect(
      AutopilotSenderRulePreviewRequestSchema.safeParse({
        version: 1,
        action: 'delete',
        reach: 'all_mail',
        excludedSenderKeys: rule.senderKeys,
      }).success,
    ).toBe(true);
    expect(
      AutopilotSenderRulePreviewRequestSchema.safeParse({ version: 1, messageIds: ['unreviewed'] })
        .success,
    ).toBe(false);
  });
});
