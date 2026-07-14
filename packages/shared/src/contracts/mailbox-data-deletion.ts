// D245 mailbox indexed-data deletion transport. The Gmail address is part
// of the typed confirmation so a user cannot approve the wrong inbox from a
// multi-mailbox account.

import { z } from 'zod';

export const MAILBOX_DATA_DELETION_CONFIRM_PREFIX = 'DELETE ';

export function mailboxDataDeletionConfirmPhrase(email: string): string {
  return `${MAILBOX_DATA_DELETION_CONFIRM_PREFIX}${email}`;
}

export const MailboxDataDeletionRequestSchema = z.object({
  confirmPhrase: z.string().min(1, 'Type the confirmation phrase to continue.').max(512),
});
export type MailboxDataDeletionRequest = z.infer<typeof MailboxDataDeletionRequestSchema>;

export const MailboxDataDeletionStatusSchema = z.enum([
  'pending',
  'executing',
  'completed',
  'failed',
]);
export type MailboxDataDeletionStatus = z.infer<typeof MailboxDataDeletionStatusSchema>;

export const MailboxIndexedDataStateSchema = z.enum([
  'indexed',
  'retained',
  'deletion_pending',
  'deleting',
  'deletion_delayed',
  'deleted',
]);
export type MailboxIndexedDataState = z.infer<typeof MailboxIndexedDataStateSchema>;

export const MailboxDataDeletionViewSchema = z.object({
  id: z.string().uuid(),
  status: MailboxDataDeletionStatusSchema,
  requestedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type MailboxDataDeletionView = z.infer<typeof MailboxDataDeletionViewSchema>;

export interface MailboxDataDeletionReceipt {
  mailbox: {
    id: string;
    email: string;
    status: 'disconnected';
    indexedDataState: MailboxIndexedDataState;
  };
  request: MailboxDataDeletionView;
}
