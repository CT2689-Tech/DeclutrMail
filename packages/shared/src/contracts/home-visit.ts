import { z } from 'zod';

export const HomeVisitRequestSchema = z.object({ visitId: z.uuid() }).strict();
export const HomeVisitWindowSchema = z.object({
  visitId: z.uuid(),
  since: z.iso.datetime().nullable(),
  until: z.iso.datetime(),
});
export type HomeVisitWindow = z.infer<typeof HomeVisitWindowSchema>;
export const HomeVisitSummarySchema = HomeVisitWindowSchema.extend({
  indexedEmails: z.number().int().nonnegative().nullable(),
  indexedSenders: z.number().int().nonnegative().nullable(),
}).refine((value) => value.since === null || value.since <= value.until);
export type HomeVisitSummary = z.infer<typeof HomeVisitSummarySchema>;
export type HomeVisitCounts = Pick<HomeVisitSummary, 'indexedEmails' | 'indexedSenders'>;
