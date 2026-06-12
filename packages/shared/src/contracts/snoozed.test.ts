import { describe, expect, it } from 'vitest';

import { SNOOZE_REASON_MAX_LENGTH, SnoozeUpdateRequestSchema } from './snoozed';

describe('SnoozeUpdateRequestSchema (D79/D82)', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  it('accepts a future ISO until with an optional reason', () => {
    expect(SnoozeUpdateRequestSchema.safeParse({ until: future }).success).toBe(true);
    expect(
      SnoozeUpdateRequestSchema.safeParse({ until: future, reason: 'after launch' }).success,
    ).toBe(true);
  });

  it('accepts until: null (cancel snooze) without a reason', () => {
    expect(SnoozeUpdateRequestSchema.safeParse({ until: null }).success).toBe(true);
  });

  it('rejects a past until', () => {
    const result = SnoozeUpdateRequestSchema.safeParse({ until: past });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/future/i);
    }
  });

  it('rejects reason alongside until: null', () => {
    expect(SnoozeUpdateRequestSchema.safeParse({ until: null, reason: 'x' }).success).toBe(false);
  });

  it('rejects non-ISO until, empty reason, over-long reason, unknown keys', () => {
    expect(SnoozeUpdateRequestSchema.safeParse({ until: 'tomorrow' }).success).toBe(false);
    expect(SnoozeUpdateRequestSchema.safeParse({ until: future, reason: '  ' }).success).toBe(
      false,
    );
    expect(
      SnoozeUpdateRequestSchema.safeParse({
        until: future,
        reason: 'x'.repeat(SNOOZE_REASON_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(SnoozeUpdateRequestSchema.safeParse({ until: future, extra: true }).success).toBe(false);
    expect(SnoozeUpdateRequestSchema.safeParse({}).success).toBe(false);
  });
});
