import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import {
  GMAIL_DISCONNECT_DATA_INVENTORY,
  GMAIL_INDEXED_DATA_DELETION_INVENTORY,
} from '@declutrmail/shared';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';

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

// ─── matchMedia stub (mirrors triage-row.test.tsx) ──────────────────
const originalMatchMedia = window.matchMedia;
function setViewportWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const limit = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(query);
    const matches = limit != null && width <= Number(limit[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('MailboxDataControlsDialog', () => {
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('opens on Keep current setup, and Enter does not disconnect or delete', () => {
    const { onDisconnect, onDeleteIndexedData } = renderDialog();
    const cancel = screen.getByRole('button', { name: /keep current setup/i });
    expect(
      screen.getByRole('alertdialog', { name: /disconnect person@example\.com/i }),
    ).toBeInTheDocument();
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(onDisconnect).not.toHaveBeenCalled();
    expect(onDeleteIndexedData).not.toHaveBeenCalled();
  });

  it('renders as a bottom sheet at phone width without dropping the inventory', () => {
    setViewportWidth(375);
    renderDialog();
    const dialog = screen.getByRole('dialog', { name: /disconnect person@example\.com/i });
    // Phone layout is pure CSS (the shared sheet's ≤520px rule).
    expect(dialog).toHaveClass('dm-sheet-panel');
    expect(
      screen.getByRole('heading', { name: /disconnect and keep saved data/i }),
    ).toBeInTheDocument();
  });

  it('shows both active-mailbox outcomes and generated inventory counts', () => {
    renderDialog();

    expect(screen.getByRole('dialog', { name: /disconnect person@example\.com/i })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    expect(
      screen.getByRole('heading', { name: /disconnect and keep saved data/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /disconnect & delete saved data/i }),
    ).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: /disconnect person@example\.com/i });
    expect(dialog.textContent?.toLowerCase()).not.toContain('mailbox');
    expect(dialog).toHaveTextContent(
      `${WS2_COPY.simplify.dataControls.deleteBodyConnected} ${WS2_COPY.simplify.dataControls.deleteRemain} ${WS2_COPY.liveFix.mailboxes.deleteReconnect}`,
    );
    expect(dialog).not.toHaveTextContent(WS2_COPY.simplify.dataControls.deleteBody);
    expect(screen.queryByText(/Removed on disconnect/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deleted from DeclutrMail/)).not.toBeInTheDocument();
    const summaries = screen.getAllByText(WS2_COPY.simplify.dataControls.inventoryToggle);
    expect(summaries).toHaveLength(2);

    const disconnectDetails = summaries[0]?.closest('details');
    const deleteDetails = summaries[1]?.closest('details');
    expect(disconnectDetails).not.toBeNull();
    expect(deleteDetails).not.toBeNull();
    fireEvent.click(summaries[0]!);
    fireEvent.click(summaries[1]!);
    expect(
      within(disconnectDetails as HTMLElement).getByRole('heading', {
        name: WS2_COPY.simplify.dataControls.keptAfterDisconnect,
      }),
    ).toBeInTheDocument();
    expect(
      within(disconnectDetails as HTMLElement).getByText(GMAIL_DISCONNECT_DATA_INVENTORY[0]!.label),
    ).toBeInTheDocument();
    expect(
      within(deleteDetails as HTMLElement).getByRole('heading', {
        name: WS2_COPY.simplify.dataControls.keptAfterDelete,
      }),
    ).toBeInTheDocument();
    expect(
      within(deleteDetails as HTMLElement).getByText(
        GMAIL_INDEXED_DATA_DELETION_INVENTORY[0]!.label,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Changes already made in Gmail stay/i)).toBeInTheDocument();
    expect(screen.getByText(/email and labels in Gmail don.t change/i)).toBeInTheDocument();
    // The options state their own consequences once — no help block restating both.
    expect(screen.queryByText('Which mailbox exit should I choose?')).not.toBeInTheDocument();
    expect(screen.getByText(/so you can reconnect later/i)).toBeInTheDocument();
    expect(screen.getByText(/Undo for this account ends/i)).toBeInTheDocument();
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
      name: /disconnect & delete saved data/i,
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
      screen.queryByRole('heading', { name: /disconnect and keep saved data/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^delete saved data$/i })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: /manage data for person@example\.com/i });
    expect(dialog.textContent?.toLowerCase()).not.toContain('mailbox');
    expect(dialog).toHaveTextContent(
      `${WS2_COPY.simplify.dataControls.deleteBody} ${WS2_COPY.simplify.dataControls.deleteRemain} ${WS2_COPY.liveFix.mailboxes.deleteReconnect}`,
    );
    expect(dialog).not.toHaveTextContent(WS2_COPY.simplify.dataControls.deleteBodyConnected);
  });

  it('surfaces an error and disables cancellation while a request is in flight', () => {
    renderDialog({ isDeleting: true, error: 'Deletion could not be started.' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be started/i);
    expect(screen.getByRole('button', { name: /keep current setup/i })).toBeDisabled();
  });
});
