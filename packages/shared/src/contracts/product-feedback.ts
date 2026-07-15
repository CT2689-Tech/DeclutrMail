import { z } from 'zod';

const ReferenceIdSchema = z.string().uuid();

/**
 * First-party calibrated feedback (D246).
 *
 * The reference is an internal row UUID used only to attach and restore the
 * user's choice. Product analytics intentionally receives only surface and
 * rating, never this identifier.
 */
export const ProductFeedbackRequestSchema = z.discriminatedUnion('surface', [
  z
    .object({
      surface: z.literal('activity'),
      referenceId: ReferenceIdSchema,
      rating: z.enum(['expected', 'surprising']),
    })
    .strict(),
  z
    .object({
      surface: z.literal('brief'),
      referenceId: ReferenceIdSchema,
      rating: z.enum(['useful', 'not_useful', 'wrong_reason']),
    })
    .strict(),
  z
    .object({
      surface: z.literal('followups'),
      referenceId: ReferenceIdSchema,
      rating: z.enum(['useful', 'not_followup']),
    })
    .strict(),
]);

export type ProductFeedbackRequest = z.infer<typeof ProductFeedbackRequestSchema>;
export type ProductFeedbackSurface = ProductFeedbackRequest['surface'];
export type ProductFeedbackRating = ProductFeedbackRequest['rating'];

export interface ProductFeedbackResult {
  id: string;
  surface: ProductFeedbackSurface;
  referenceId: string;
  rating: ProductFeedbackRating;
  createdAt: string;
  updatedAt: string;
}
