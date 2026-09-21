// Interactive contract for the shared `PreviewSheet` (ADR-0042). It lives
// here, not beside the component: the shared package's suite is SSR-only
// by house style, and this one needs a DOM (focus, Esc, scrim press).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PreviewSheet, SheetSegmented } from '@declutrmail/shared';

function renderSheet(overrides: Partial<Parameters<typeof PreviewSheet>[0]> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(
    <PreviewSheet
      onClose={onClose}
      title="Archive 174 emails?"
      subtitle="From Macy's. They leave your inbox and stay in Gmail."
      note="Undo from Activity for 30 days."
      details={<p>Counted now, rechecked when it runs.</p>}
      primary={{ label: 'Archive 174', onClick: onConfirm }}
      {...overrides}
    />,
  );
  return { onClose, onConfirm };
}

describe('<PreviewSheet />', () => {
  it('is a modal dialog named by its title and described by its one sentence', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Archive 174 emails?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/leave your inbox/);
  });

  it('keeps everything that is not count / destination / undo collapsed', () => {
    renderSheet();
    const details = screen.getByText('Details').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('runs the action from the primary button and closes from Cancel', () => {
    const { onClose, onConfirm } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Archive 174' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Esc and on a scrim press, but not while the request is in flight', () => {
    const idle = renderSheet();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(idle.onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector('[data-dm-preview-sheet]')!);
    expect(idle.onClose).toHaveBeenCalledTimes(2);
  });

  it('locks every way out while busy and shows the busy label', () => {
    const { onClose, onConfirm } = renderSheet({
      primary: { label: 'Archive 174', onClick: vi.fn(), busyLabel: 'Archiving…' },
    });
    expect(screen.getByRole('button', { name: 'Archiving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.mouseDown(document.querySelector('[data-dm-preview-sheet]')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('leaves an Esc another layer already handled alone', () => {
    const { onClose } = renderSheet();
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('puts first focus on the action — and on Cancel when the action is destructive', () => {
    const safe = render(
      <PreviewSheet
        onClose={() => {}}
        title="Archive 3 emails?"
        primary={{ label: 'Archive 3', onClick: () => {} }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Archive 3' })).toHaveFocus();
    safe.unmount();

    render(
      <PreviewSheet
        onClose={() => {}}
        title="Delete 3 emails?"
        primary={{ label: 'Delete 3', onClick: () => {}, tone: 'danger' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('announces status through a live region that exists before the first message', () => {
    renderSheet({ status: 'Could not archive. Try again.' });
    expect(screen.getByRole('status')).toHaveTextContent('Could not archive');
  });
});

describe('<SheetSegmented />', () => {
  it('is a radio group that reports the chosen option with its count', () => {
    const onChange = vi.fn();
    render(
      <SheetSegmented
        label="Where it applies"
        value="inbox"
        onChange={onChange}
        options={[
          { value: 'inbox', label: 'Inbox only', count: 0 },
          { value: 'all', label: 'Inbox + archived', count: 6728 },
        ]}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Where it applies' });
    expect(within(group).getByRole('radio', { name: /Inbox only/ })).toBeChecked();
    fireEvent.click(within(group).getByRole('radio', { name: /Inbox \+ archived\s*6,728/ }));
    expect(onChange).toHaveBeenCalledWith('all');
  });
});
