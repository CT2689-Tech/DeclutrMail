import { z } from 'zod';

/** Metadata already scanned into this mailbox. No Gmail quota or storage-savings claim. */
export const MailboxSnapshotSchema = z.object({
  asOf: z.iso.datetime(),
  inboxCount: z.number().int().nonnegative(),
  unreadInboxCount: z.number().int().nonnegative(),
  receivedCount: z.number().int().nonnegative(),
  totalBytes: z.number().nonnegative().nullable(),
  sizeKnownCount: z.number().int().nonnegative(),
});

export type MailboxSnapshot = z.infer<typeof MailboxSnapshotSchema>;
