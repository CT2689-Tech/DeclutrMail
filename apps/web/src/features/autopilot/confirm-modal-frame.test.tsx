import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConfirmModalFrame } from './confirm-modal-frame';
it('shows the affected account without opening Details', () => {
  render(
    <ConfirmModalFrame
      title="Turn on rule?"
      subtitle="Watch matches"
      mailboxEmail="qa@synthetic.test"
      facts={[{ label: 'Rule', value: 'Synthetic rule' }]}
      confirmLabel="Turn on"
      confirmBusyLabel="Saving"
      canConfirm
      isBusy={false}
      error={null}
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    />,
  );
  expect(screen.getByText('qa@synthetic.test').closest('details')).toBeNull();
  expect(screen.getByText('Synthetic rule').closest('details')).not.toHaveAttribute('open');
});
