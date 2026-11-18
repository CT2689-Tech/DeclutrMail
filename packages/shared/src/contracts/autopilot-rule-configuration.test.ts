import { describe, expect, it } from 'vitest';
import { AutopilotRuleConfigurationSchema, isReviewOnlyRule } from './autopilot-rule-configuration';
const configuration = {
  version: 1,
  name: 'Old mail',
  conditions: {
    kind: 'dormant',
    lastSeenAfterDays: 90,
    lastSeenWithinDays: null,
    readRateBelow: 0.05,
    minMessages: 5,
  },
};
describe('Autopilot action reach', () => {
  it('accepts Delete in either explicit mailbox reach', () => {
    for (const reach of ['inbox_only', 'all_mail'])
      expect(
        AutopilotRuleConfigurationSchema.safeParse({
          ...configuration,
          actionKind: 'delete',
          reach,
        }).success,
      ).toBe(true);
  });
  it('keeps Archive, Later and Unsubscribe from widening', () => {
    for (const actionKind of ['archive', 'later', 'unsubscribe'])
      expect(
        AutopilotRuleConfigurationSchema.safeParse({
          ...configuration,
          actionKind,
          reach: 'all_mail',
        }).success,
      ).toBe(false);
  });
});

describe('isReviewOnlyRule', () => {
  it('keeps Delete and the new-sender matcher review-only, and nothing else', () => {
    expect(isReviewOnlyRule({ presetKey: null, actionKind: 'delete' })).toBe(true);
    expect(
      isReviewOnlyRule({ presetKey: 'auto_archive_low_engagement', actionKind: 'delete' }),
    ).toBe(true);
    // The new-sender matcher failed the 2026-11-17 matching check, whatever its verb.
    expect(isReviewOnlyRule({ presetKey: 'auto_screen_new_senders', actionKind: 'later' })).toBe(
      true,
    );
    expect(isReviewOnlyRule({ presetKey: 'auto_screen_new_senders', actionKind: 'archive' })).toBe(
      true,
    );
    // Archive may run on its own: the low-engagement preset and custom sender rules.
    expect(
      isReviewOnlyRule({ presetKey: 'auto_archive_low_engagement', actionKind: 'archive' }),
    ).toBe(false);
    expect(isReviewOnlyRule({ presetKey: null, actionKind: 'archive' })).toBe(false);
    expect(
      isReviewOnlyRule({ presetKey: 'auto_unsubscribe_noisy', actionKind: 'unsubscribe' }),
    ).toBe(false);
  });
});
