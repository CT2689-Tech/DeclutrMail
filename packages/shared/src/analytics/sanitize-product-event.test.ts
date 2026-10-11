import { describe, expect, it } from 'vitest';

import {
  bucketDurationSeconds,
  bucketEmailCount,
  sanitizeErrorClass,
  sanitizeProductEvent,
} from './sanitize-product-event';

const USER = '11111111-1111-4111-8111-111111111111';

describe('sanitizeProductEvent', () => {
  it('keeps a closed signup event', () => {
    expect(sanitizeProductEvent('signup_completed', { provider: 'google' }, USER)).toEqual({
      name: 'signup_completed',
      props: { provider: 'google' },
      userId: USER,
    });
  });

  it('drops the event when a prop contains an email address', () => {
    expect(
      sanitizeProductEvent('signup_completed', { provider: 'ada@example.com' }, USER),
    ).toBeNull();
  });

  it('drops an unknown key instead of storing it', () => {
    expect(
      sanitizeProductEvent('gmail_connected', { mode: 'login', snippet: 'hello' }, USER),
    ).toBeNull();
  });

  it('drops a user id that is not a uuid', () => {
    expect(
      sanitizeProductEvent('gmail_connected', { mode: 'login' }, 'ada@example.com'),
    ).toBeNull();
  });

  it('buckets duration and email counts down to the published floors', () => {
    expect(bucketDurationSeconds(29_000)).toBe(0);
    expect(bucketDurationSeconds(30_000)).toBe(30);
    expect(bucketDurationSeconds(7_200_000)).toBe(7200);
    expect(bucketEmailCount(99)).toBe(0);
    expect(bucketEmailCount(100)).toBe(100);
    expect(bucketEmailCount(100_000)).toBe(100000);
    expect(sanitizeErrorClass('TransientError')).toBe('TransientError');
    expect(sanitizeErrorClass('not a class')).toBe('UnknownError');
  });
});
