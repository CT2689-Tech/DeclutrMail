import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY,
} from '@declutrmail/shared';

import type { MeMailbox } from '@/features/auth/api/use-me';
import { MailboxDataControlsDialog } from './mailbox-data-controls-dialog';

const ACTIVE_MAILBOX: MeMailbox = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'person@example.com',
  status: 'active',
  connectedAt: '2026-07-01T00:00:00.000Z',
  readiness: 'ready',
  indexedDataState: 'indexed',
  dataDeletion: null,
};

function renderDialog(overrides: Partial<Parameters<typeof MailboxDataControlsDialog>[0]> = {}) {
  const onDisconnect = vi.fn();
  const onDeleteIndexedData = vi.fn();
  const onCancel = vi.fn();
  render(
    <MailboxDataControlsDialog
      mailbox={ACTIVE_MAILBOX}
      onCancel={onCancel}
      onDisconnect={onDisconnect}
      onDeleteIndexedData={onDeleteIndexedData}
      isDisconnecting={false}
      isDeleting={false}
      error={null}
      {...overrides}
    />,
  );
  return { onDisconnect, onDeleteIndexedData, onCancel };
}

describe('MailboxDataControlsDialog', () => {
  it('shows both active-mailbox outcomes and generated inventory counts', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: /disconnect person@example\.com/i })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: /disconnect and keep indexed data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /disconnect & delete indexed data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Removed on disconnect (${GMAIL_DISCONNECT_DATA_INVENTORY.length} ${GMAIL_DISCONNECT_DATA_INVENTORY.length === 1 ? 'category' : 'categories'})`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Deleted from DeclutrMail (${GMAIL_INDEXED_DATA_DELETION_INVENTORY.length} categories)`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Retained after disconnect (${GMAIL_INDEXED_DATA_DELETION_INVENTORY.length + GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY.length} categories)`,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        `Retained after deletion (${GMAIL_INDEXED_DATA_DELETION_RETAINED_INVENTORY.length} categories)`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/past Gmail actions stay applied/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Gmail is unchanged/i).length).toBeGreaterThan(0);
  });

  it('runs standard disconnect without requiring the destructive phrase', () => {
    const { onDisconnect } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /disconnect and keep data/i }));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it('requires the exact mailbox-specific phrase before destructive deletion', () => {
    const { onDeleteIndexedData } = renderDialog();
    const input = screen.getByLabelText(/type DELETE person@example\.com/i);
    const destructive = screen.getByRole('button', {
      name: /disconnect & delete indexed data/i,
    });

    expect(destructive).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE other@example.com' } });
    expect(destructive).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE person@example.com' } });
    expect(destructive).toBeEnabled();
    fireEvent.click(destructive);
    expect(onDeleteIndexedData).toHaveBeenCalledWith('DELETE person@example.com');
  });

  it('shows only the purge choice for a disconnected mailbox with retained data', () => {
    renderDialog({
      mailbox: {
        ...ACTIVE_MAILBOX,
        status: 'disconnected',
        indexedDataState: 'retained',
      },
    });
    expect(
      screen.getByRole('dialog', { name: /manage data for person@example\.com/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: /disconnect and keep indexed data/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^delete indexed data$/i })).toBeInTheDocument();
  });

  it('surfaces an error and disables cancellation while a request is in flight', () => {
    renderDialog({ isDeleting: true, error: 'Deletion could not be started.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be started/i);
    expect(screen.getByRole('button', { name: /keep current setup/i })).toBeDisabled();
  });
});
