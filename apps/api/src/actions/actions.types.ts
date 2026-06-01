import { z } from 'zod';

/**
 * Action API contracts (D226).
 *
 * The EXTERNAL selector the FE sends. `sender` carries the `senderId`
 * (the `senders.id` uuid the Sender Detail screen already has) — the
 * service resolves it to the sha256 `sender_key` server-side, which also
 * enforces ownership. The sha256 key is never asked of the client.
 *
 * `messages` is capped so a single request can't carry an unbounded id
 * list (the bulk path is the sender selector, which the worker resolves
 * itself). Privacy (D7): the selector carries ids only.
 */

/** Max ids accepted in one `messages` selector. Bulk → use the sender selector. */
export const MESSAGES_SELECTOR_MAX = 500;

export const archiveSelectorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sender'), senderId: z.string().uuid() }).strict(),
  z
    .object({
      type: z.literal('messages'),
      messageIds: z.array(z.string().min(1)).min(1).max(MESSAGES_SELECTOR_MAX),
    })
    .strict(),
]);
export type ArchiveSelector = z.infer<typeof archiveSelectorSchema>;

export const archiveRequestSchema = z
  .object({
    selector: archiveSelectorSchema,
    /** Required to act on a Protected / VIP sender (defense-in-depth, D42). */
    override: z.boolean().optional(),
  })
  .strict();
export type ArchiveRequest = z.infer<typeof archiveRequestSchema>;

export type ActionJobStatus = 'queued' | 'executing' | 'done' | 'failed';

export interface ActionEnqueueResult {
  actionId: string;
  requestedCount: number;
  status: ActionJobStatus;
}

export interface ActionStatusResult {
  actionId: string;
  status: ActionJobStatus;
  requestedCount: number;
  affectedCount: number;
  undoToken: string | null;
  errorCode: string | null;
}

/**
 * Non-mutating archive preview (D226). `inboxCount` is the REAL number of
 * the sender's messages currently labelled INBOX — the exact set the
 * archive will move — so the confirm modal states what actually changes
 * instead of a client-side estimate.
 */
export interface ArchivePreviewResult {
  senderId: string;
  inboxCount: number;
}
