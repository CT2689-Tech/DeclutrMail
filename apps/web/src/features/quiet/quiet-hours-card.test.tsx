/**
 * Tests for `QuietHoursCard` (U18 — D92/D95).
 *
 * The card is prop-driven, so every branch is reachable without query
 * mocking: loading / error / ready(unconfigured) / ready(configured) /
 * quiet-now / disconnected / saving, plus the form contract — dirty
 * gating, client-side window sanity (start ≠ end), and the
 * cross-midnight hint.
 */

import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
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

describe('QuietHoursCard — save status', () => {
  const saveStatus = () => screen.getByRole('status', { name: 'Save status for a@b.com' });
  const visibleSaved = () =>
    screen.getByText('Saved', { ignore: '[role="status"], script, style' });

  it('announces a finished save, and screen readers hear it once', () => {
    renderCard({ justSaved: true });
    expect(saveStatus()).toHaveTextContent('Saved');
    expect(visibleSaved()).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves the visible label readable while no save is announced', () => {
    renderCard();
    expect(saveStatus().textContent).toBe('');
    expect(visibleSaved()).not.toHaveAttribute('aria-hidden');
  });

  it('says nothing saved beside the error branch', () => {
    renderCard({ state: { kind: 'error', message: 'Boom (HTTP 500).' }, justSaved: true });
    expect(saveStatus().textContent).toBe('');
  });
});

describe('QuietHoursCard — form contract', () => {
  it('renders the saved config in the form', () => {
    renderCard();
    expect(screen.getByLabelText('Quiet window start')).toHaveValue('22:00');
    expect(screen.getByLabelText('Quiet window end')).toHaveValue('06:00');
    expect(screen.getByLabelText('Quiet window timezone')).toHaveValue('Asia/Kolkata');
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeChecked();
  });

  it('Save is disabled until the form is dirty', async () => {
    renderCard();
    const save = screen.getByRole('button', { name: 'Save quiet hours' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));
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
    expect(screen.getByText(/06:00 the next day/)).toBeInTheDocument();
  });

  it('hides the cross-midnight hint for a same-day window', () => {
    renderCard({
      state: {
        kind: 'ready',
        config: { ...CONFIG, startLocal: '09:00', endLocal: '17:00' },
        activeNow: false,
      },
    });
    expect(screen.queryByText(/next day/)).not.toBeInTheDocument();
  });

  it('disables the whole form while saving', () => {
    renderCard({ saving: true });
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).toBeDisabled();
    expect(screen.getByLabelText('Quiet window start')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('unconfigured mailbox gets the disabled-by-default draft', () => {
    renderCard({ state: { kind: 'ready', config: null, activeNow: false } });
    expect(screen.getByRole('switch', { name: 'Quiet hours' })).not.toBeChecked();
    expect(screen.getByLabelText('Quiet window start')).toHaveValue('22:00');
    expect(screen.getByLabelText('Quiet window end')).toHaveValue('07:00');
  });

  it('says Saved only when quiet hours are stored', () => {
    renderCard({ state: { kind: 'ready', config: null, activeNow: false } });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('says Saved for a stored config the form still matches', () => {
    renderCard();
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('reports each edit, so the screen can end a finished save', async () => {
    const onEdit = vi.fn();
    renderCard({ onEdit });
    await userEvent.click(screen.getByRole('switch', { name: 'Quiet hours' }));
    fireEvent.change(screen.getByLabelText('Quiet window start'), {
      target: { value: '20:30' },
    });
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it('hydrates before loading the browser timezone catalog', async () => {
    const supportedValues = vi.spyOn(Intl, 'supportedValuesOf');
    supportedValues.mockReturnValue(['Etc/GMT']);
    const props: QuietHoursCardProps = {
      mailboxEmail: 'a@b.com',
      mailboxStatus: 'active',
      state: { kind: 'ready', config: CONFIG, activeNow: false },
      saving: false,
      onSave: vi.fn(),
    };
    const container = document.createElement('div');
    container.innerHTML = renderToString(<QuietHoursCard {...props} />);

    supportedValues.mockReturnValue(['America/Coyhaique', 'Etc/GMT']);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let root: Root | undefined;
    await act(async () => {
      root = hydrateRoot(container, <QuietHoursCard {...props} />);
    });

    expect(
      consoleError.mock.calls.some(([message]) => String(message).includes('Hydration failed')),
    ).toBe(false);

    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    fireEvent.focus(select!);
    expect([...select!.options].map((option) => option.value)).toContain('America/Coyhaique');

    await act(async () => root?.unmount());
    supportedValues.mockRestore();
  });
});
