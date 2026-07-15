import { z } from 'zod';

import { isValidTimeZone } from './quiet-hours';

/** Authenticated browser-zone synchronization request (D64/D246). */
export const TimeZonePatchSchema = z
  .object({
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine(isValidTimeZone, 'timezone must be a valid IANA timezone name'),
  })
  .strict();

export type TimeZonePatch = z.infer<typeof TimeZonePatchSchema>;
