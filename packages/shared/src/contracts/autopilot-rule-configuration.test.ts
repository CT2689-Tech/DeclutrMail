import { describe, expect, it } from 'vitest';
import { AutopilotRuleConfigurationSchema } from './autopilot-rule-configuration';
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
