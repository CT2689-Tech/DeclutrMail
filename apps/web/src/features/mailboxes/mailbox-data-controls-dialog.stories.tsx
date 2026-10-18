import type { ComponentProps } from 'react';

import { MailboxDataControlsDialog } from './mailbox-data-controls-dialog';

type Props = ComponentProps<typeof MailboxDataControlsDialog>;

export default {
  title: 'Mailboxes/DataControlsDialog',
  component: MailboxDataControlsDialog,
  parameters: { layout: 'fullscreen' },
};

const mailbox: NonNullable<Props['mailbox']> = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a-very-long-mailbox-name.for-narrow-dialog-validation@example.test',
  status: 'active',
  connectedAt: '2026-10-01T00:00:00.000Z',
  readiness: 'ready',
  indexedDataState: 'indexed',
  dataDeletion: null,
};

const base: Props = {
  mailbox,
  onCancel: () => {},
  onDisconnect: () => {},
  onDeleteIndexedData: () => {},
  isDisconnecting: false,
  isDeleting: false,
  error: null,
};

export const Connected = { args: base };
export const Disconnected = { args: { ...base, mailbox: { ...mailbox, status: 'disconnected' } } };
export const Error = { args: { ...base, error: 'The request could not be completed. Try again.' } };
export const Submitting = { args: { ...base, isDeleting: true } };
