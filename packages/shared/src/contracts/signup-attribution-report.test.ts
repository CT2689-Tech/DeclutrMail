import { describe, expect, it } from 'vitest';
import {
  SIGNUP_HEARD_FROM_CHOICES,
  SIGNUP_HEARD_FROM_VALUES,
  SignupHeardFromPatchSchema,
  parseSignupAttributionRef,
} from './signup-attribution';
import { SignupAttributionReportSchema } from './signup-attribution-report';
const snapshot = () => ({
  observedAt: '2026-10-27T18:00:00.000Z',
  totalAccounts: 4,
  answered: 2,
  skipped: 1,
  unanswered: 1,
  unrecognized: 1,
  channels: SIGNUP_HEARD_FROM_VALUES.filter((channel) => channel !== 'skipped').map((channel) => ({
    channel,
    count: channel === 'friend' ? 1 : 0,
  })),
});
describe('self-report channels', () => {
  it('accepts the new survey choices without widening tracked referral values', () => {
    for (const channel of ['google', 'ai_assistant', 'youtube', 'instagram', 'tiktok']) {
      expect(SignupHeardFromPatchSchema.parse({ heardFrom: channel })).toEqual({
        heardFrom: channel,
      });
      expect(parseSignupAttributionRef(channel)).toBeUndefined();
      expect(
        SignupHeardFromPatchSchema.safeParse({ heardFrom: channel, detail: 'unrelated' }).success,
      ).toBe(false);
    }
    expect(new Set(SIGNUP_HEARD_FROM_CHOICES.map((c) => c.value)).size).toBe(
      SIGNUP_HEARD_FROM_CHOICES.length,
    );
    expect(SIGNUP_HEARD_FROM_CHOICES.map((c) => c.value).sort()).toEqual(
      SIGNUP_HEARD_FROM_VALUES.filter((c) => c !== 'other' && c !== 'skipped').sort(),
    );
  });
});
describe('private aggregate contract', () => {
  it('reconciles unknown answers without dropping them', () => {
    expect(SignupAttributionReportSchema.parse(snapshot()).answered).toBe(2);
  });
  it('rejects missing, duplicate, contradictory and identity-bearing data', () => {
    const report = snapshot();
    for (const bad of [
      { ...report, totalAccounts: 3 },
      { ...report, unrecognized: 0 },
      { ...report, channels: report.channels.slice(1) },
      { ...report, channels: [...report.channels, report.channels[0]] },
      { ...report, email: 'private@example.test' },
      { ...report, observedAt: 'unknown' },
    ])
      expect(SignupAttributionReportSchema.safeParse(bad).success).toBe(false);
  });
});
