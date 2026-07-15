import { describe, expect, it } from 'vitest';

import { TimeZonePatchSchema } from './timezone';

describe('TimeZonePatchSchema', () => {
  it('accepts canonical IANA zones', () => {
    expect(TimeZonePatchSchema.parse({ timezone: 'America/Los_Angeles' })).toEqual({
      timezone: 'America/Los_Angeles',
    });
    expect(TimeZonePatchSchema.parse({ timezone: 'Asia/Kolkata' })).toEqual({
      timezone: 'Asia/Kolkata',
    });
  });

  it('rejects invalid zones and unknown keys', () => {
    expect(TimeZonePatchSchema.safeParse({ timezone: 'Mars/Olympus_Mons' }).success).toBe(false);
    expect(TimeZonePatchSchema.safeParse({ timezone: 'UTC', locale: 'en-US' }).success).toBe(false);
  });
});
