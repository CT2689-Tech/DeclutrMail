/**
 * Tests for `QuietHoursCard` (U18 — D92/D95).
 *
 * The card is prop-driven, so every branch is reachable without query
 * mocking: loading / error / ready(unconfigured) / ready(configured) /
 * quiet-now / disconnected / saving, plus the form contract — dirty
 * gating, client-side window sanity (start ≠ end), and the
 * cross-midnight hint.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuietHoursCard, type QuietHoursCardProps } from './quiet-hours-card';

const CONFIG = {
  enabled: true,
  startLocal: '22:00',
  endLocal: '06:00',
  timezone: 'Asia/Kolkata',
};

function renderCard(overrides: Partial<QuietHoursCardProps> = {}) {
  const props: QuietHoursCardProps = {
    mailboxEmail: 'a@b.com',
    mailboxStatus: 'active',
    state: { kind: 'ready', config: CONFIG, activeNow: false },
    saving: false,
    onSave: vi.fn(),
    ...overrides,
  };
  render(<QuietHoursCard {...props} />);
  return props;
}

describe('QuietHoursCard — edge states', () => {
  it('renders the loading skeleton', () => {
    renderCard({ state: { kind: 'loading' } });
    expect(screen.getByTestId('quiet-card-loading')).toBeInTheDocument();
  });

  it('renders the error branch with a Retry that fires onRetry', async () => {
    const onRetry = vi.fn();
    renderCard({
      state: { kind: 'error', message: 'Boom (HTTP 500).' },
      onRetry,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Boom (HTTP 500).');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the "Quiet now" pill only when activeNow', () => {
    renderCard({ state: { kind: 'ready', config: CONFIG, activeNow: true } });
    expect(screen.getByText('Quiet now')).toBeInTheDocument();
  });

  it('hides the "Quiet now" pill when inactive', () => {
    renderCard();
    expect(screen.queryByText('Quiet now')).not.toBeInTheDocument();
  });

  it('shows the Disconnected pill for a disconnected mailbox', () => {
    renderCard({ mailboxStatus: 'disconnected' });
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });
});

describe('QuietHoursCard — form contract', () => {
  it('renders the saved config in the form', () => {
    renderCard();
    expect(screen.getByLabelText('Quiet window start')).toHaveValue('22:00');
    expect(screen.getByLabelText('Quiet window end')).toHaveValue('06:00');
    expect(screen.getByLabelText('Quiet window timezone')).toHaveValue('Asia/Kolkata');
    expect(screen.getByRole('checkbox', { name: 'Quiet hours on' })).toBeChecked();
  });

  it('Save is disabled until the form is dirty', async () => {
    renderCard();
    const save = screen.getByRole('button', { name: 'Save quiet hours' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Quiet hours on' }));
    expect(save).toBeEnabled();
  });

  it('saves the edited window through onSave', async () => {
    const props = renderCard();
    fireEvent.change(screen.getByLabelText('Quiet window start'), {
      target: { value: '20:30' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    expect(props.onSave).toHaveBeenCalledWith({ ...CONFIG, startLocal: '20:30' });
  });

  it('rejects a zero-length window (start === end) client-side', async () => {
    const props = renderCard();
    fireEvent.change(screen.getByLabelText('Quiet window end'), {
      target: { value: '22:00' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save quiet hours' }));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the cross-midnight hint when start > end', () => {
    renderCard();
    expect(screen.getByText(/Crosses midnight/)).toBeInTheDocument();
  });

  it('hides the cross-midnight hint for a same-day window', () => {
    renderCard({
      state: {
        kind: 'ready',
        config: { ...CONFIG, startLocal: '09:00', endLocal: '17:00' },
        activeNow: false,
      },
    });
    expect(screen.queryByText(/Crosses midnight/)).not.toBeInTheDocument();
  });

  it('disables the whole form while saving', () => {
    renderCard({ saving: true });
    expect(screen.getByRole('checkbox', { name: 'Quiet hours on' })).toBeDisabled();
    expect(screen.getByLabelText('Quiet window start')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('unconfigured mailbox gets the disabled-by-default draft', () => {
    renderCard({ state: { kind: 'ready', config: null, activeNow: false } });
    expect(screen.getByRole('checkbox', { name: 'Quiet hours on' })).not.toBeChecked();
    expect(screen.getByLabelText('Quiet window start')).toHaveValue('22:00');
    expect(screen.getByLabelText('Quiet window end')).toHaveValue('07:00');
  });
});
