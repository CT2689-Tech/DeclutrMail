import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { ActivityRowWire } from '@/lib/api/activity';
import { ActionRecoveryDialog } from './action-recovery-dialog';

const row: ActivityRowWire = {
  id: 'a-1',
  occurredAt: '2026-10-13T08:00:00.000Z',
  source: 'manual',
  action: 'archive',
  affectedCount: 0,
  sender: null,
  rule: null,
  feedbackRating: null,
  undoState: { kind: 'unavailable' },
  executionState: null,
  reviewOutcome: null,
};

describe('recovery dismissal policy', () => {
  it('keeps focus in the review when its last enabled control becomes disabled', async () => {
    const user = userEvent.setup();
    const props = {
      row,
      preview: undefined,
      isStarting: true,
      startError: null,
      confirmError: null,
      onRetryVerification: vi.fn(),
      onConfirm: vi.fn(),
      onReconnect: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <>
        <button>Background control</button>
        <ActionRecoveryDialog {...props} isConfirming={false} />
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
    rerender(
      <>
        <button>Background control</button>
        <ActionRecoveryDialog {...props} isConfirming />
      </>,
    );
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    await user.tab();
    expect(dialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(dialog).toHaveFocus();
    await user.click(document.querySelector('.dm-scrim') as HTMLElement);
    expect(dialog).toHaveFocus();
    rerender(
      <>
        <button>Background control</button>
        <ActionRecoveryDialog {...props} isConfirming={false} />
      </>,
    );
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('locks backdrop, Escape and Close during confirmation, then restores dismissal', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const props = {
      row,
      preview: undefined,
      isStarting: true,
      startError: null,
      confirmError: null,
      isConfirming: true,
      onRetryVerification: vi.fn(),
      onConfirm: vi.fn(),
      onReconnect: vi.fn(),
      onClose,
    };
    const { rerender } = render(<ActionRecoveryDialog {...props} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.click(document.querySelector('.dm-scrim') as HTMLElement);
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    rerender(<ActionRecoveryDialog {...props} isConfirming={false} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(document.querySelector('.dm-scrim') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
