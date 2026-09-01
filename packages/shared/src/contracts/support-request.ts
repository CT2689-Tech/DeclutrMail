import { z } from 'zod';

/**
 * In-app "Contact support" form (Settings → Help & glossary). One
 * free-text message emailed to support@declutrmail.com — no ticket
 * persistence, no attachment.
 */
export const SupportRequestSchema = z
  .object({
    subject: z.string().trim().min(1).max(150),
    message: z.string().trim().min(10).max(5000),
  })
  .strict();

export type SupportRequestPayload = z.infer<typeof SupportRequestSchema>;

export interface SupportRequestResult {
  submittedAt: string;
}
