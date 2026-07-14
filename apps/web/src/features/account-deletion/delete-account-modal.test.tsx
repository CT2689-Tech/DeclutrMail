/**
 * DeleteAccountModal tests (D216 + D232).
 *
 * Prop-driven — no query client needed. Covers the 2-step gate
 * (checkbox before Continue), the typed-confirm phrase per mode, the
 * D232 undo-window copy, and the exact phrase handoff to onConfirm.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { AccountDeletionProjection } from '@declutrmail/shared/contracts';
import { DeleteAccountModal } from './delete-account-modal';

const FLAT_PROJECTION: AccountDeletionProjection = {
  flatGraceAt: '2026-06-18T00:00:00.000Z',
  latestUndoExpiresAt: null,
  activeUndoCount: 0,
  projectedEffectiveAt: '2026-06-18T00:00:00.000Z',
  projectedBasis: 'flat-grace',
};

const UNDO_PROJECTION: AccountDeletionProjection = {
  flatGraceAt: '2026-06-18T00:00:00.000Z',
  latestUndoExpiresAt: '2026-07-06T00:00:00.000Z',
  activeUndoCount: 3,
  projectedEffectiveAt: '2026-07-06T00:00:00.000Z',
  projectedBasis: 'undo-window',
};

function renderModal(
  overrides: Partial<Parameters<typeof DeleteAccountModal>[0]> = {},
): ReturnType<typeof vi.fn> {
  const onConfirm = vi.fn();
  render(
    <DeleteAccountModal
      open
      projection={FLAT_PROJECTION}
      onCancel={vi.fn()}
      onConfirm={onConfirm}
      isSubmitting={false}
      submitError={null}
      {...overrides}
    />,
  );
  return onConfirm;
}

function advanceToStep2() {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: /review deletion timing/i }));
}

describe('DeleteAccountModal', () => {
  it('step 1 gates Continue behind the acknowledgment checkbox', () => {
    renderModal();
    expect(screen.getByText(/what gets permanently deleted/i)).toBeInTheDocument();
    expect(screen.getByText(/does not delete emails in Gmail/i)).toBeInTheDocument();
    expect(screen.getByText(/what is retained under policy/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/pseudonymous security and deletion evidence/i).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/deletes everything/i)).not.toBeInTheDocument();
    const cont = screen.getByRole('button', { name: /review deletion timing/i });
    expect(cont).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(cont).toBeEnabled();
  });

  it('schedule mode requires the exact DELETE phrase', () => {
    const onConfirm = renderModal();
    advanceToStep2();

    const confirm = screen.getByRole('button', { name: /schedule deletion/i, hidden: false });
    const input = screen.getByLabelText(/type/i);

    fireEvent.change(input, { target: { value: 'delete' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(input, { target: { value: 'DELETE' } });
    expect(confirm).toBeEnabled();

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith('DELETE');
  });

  it('immediate mode requires DELETE AND WAIVE UNDO and resets prior typing', () => {
    const onConfirm = renderModal({ projection: UNDO_PROJECTION });
    advanceToStep2();

    const input = screen.getByLabelText(/type/i);
    fireEvent.change(input, { target: { value: 'DELETE' } });

    fireEvent.click(screen.getByRole('radio', { name: /delete immediately/i }));
    const confirm = screen.getByRole('button', { name: /delete immediately/i, hidden: false });
    // Prior typing was reset AND no longer matches the waiver phrase.
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: 'DELETE AND WAIVE UNDO' },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete immediately/i, hidden: false }));
    expect(onConfirm).toHaveBeenCalledWith('DELETE AND WAIVE UNDO');
  });

  it('surfaces the D232 undo copy: count, latest expiry, and the extended date', () => {
    renderModal({ projection: UNDO_PROJECTION });
    advanceToStep2();

    expect(screen.getByText(/3 undoable actions/i)).toBeInTheDocument();
    expect(screen.getByText(/undo windows are waived/i)).toBeInTheDocument();
    expect(screen.getByText(/delayed past the 7-day grace period/i)).toBeInTheDocument();
  });

  it('shows the submit error and keeps the modal open', () => {
    renderModal({ submitError: 'The confirmation phrase did not match.' });
    advanceToStep2();
    expect(screen.getByRole('alert')).toHaveTextContent(/did not match/i);
  });

  it('renders nothing when closed', () => {
    render(
      <DeleteAccountModal
        open={false}
        projection={FLAT_PROJECTION}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        isSubmitting={false}
        submitError={null}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
