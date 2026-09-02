import { describe, expect, it } from 'vitest';

import { SupportRequestSchema } from './support-request';

describe('SupportRequestSchema', () => {
  it('accepts a bounded subject + message', () => {
    const value = {
      subject: 'Cannot connect Gmail',
      message: 'I keep hitting an error at step 2.',
    };
    expect(SupportRequestSchema.parse(value)).toEqual(value);
  });

  it('trims surrounding whitespace', () => {
    const parsed = SupportRequestSchema.parse({
      subject: '  Billing question  ',
      message: '  Why was I charged twice this month?  ',
    });
    expect(parsed).toEqual({
      subject: 'Billing question',
      message: 'Why was I charged twice this month?',
    });
  });

  it('rejects an empty subject, a too-short message, and unknown fields', () => {
    expect(
      SupportRequestSchema.safeParse({ subject: '', message: 'short but not too short' }).success,
    ).toBe(false);
    expect(SupportRequestSchema.safeParse({ subject: 'Hi', message: 'too short' }).success).toBe(
      false,
    );
    expect(
      SupportRequestSchema.safeParse({
        subject: 'Hi',
        message: 'A message that is long enough to pass.',
        category: 'billing',
      }).success,
    ).toBe(false);
  });

  it('rejects a subject or message over the length cap', () => {
    expect(
      SupportRequestSchema.safeParse({
        subject: 'x'.repeat(151),
        message: 'A message that is long enough to pass.',
      }).success,
    ).toBe(false);
    expect(
      SupportRequestSchema.safeParse({ subject: 'Hi', message: 'x'.repeat(5001) }).success,
    ).toBe(false);
  });
});
