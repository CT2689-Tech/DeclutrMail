import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewSheet } from '@declutrmail/shared';

function renderPreview(disabled = false, danger = false) {
  return render(
    <PreviewSheet
      onClose={vi.fn()}
      title="Archive emails?"
      details={<a href="https://mail.google.com/">Check in Gmail</a>}
      primary={{
        label: 'Archive',
        onClick: vi.fn(),
        disabled,
        tone: danger ? 'danger' : 'default',
      }}
    />,
  );
}

describe('PreviewSheet keyboard focus', () => {
  it('focuses Cancel when the primary is disabled, skipping links in closed Details', () => {
    renderPreview(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('cycles through visible controls when Details is closed', () => {
    renderPreview(true);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const details = screen.getByText('Details');
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(details).toHaveFocus();
    fireEvent.keyDown(details, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
  });

  it('focuses an enabled primary action', () => {
    renderPreview();
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveFocus();
  });

  it('keeps Cancel as the initial focus for destructive confirmation', () => {
    renderPreview(false, true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });
});
