import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@declutrmail/shared';

describe('AppShell mobile drawer', () => {
  it('traps focus, closes on Escape, restores focus, and keeps 44px controls', () => {
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    const opener = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(opener).toHaveStyle({ width: '44px', height: '44px' });
    fireEvent.click(opener);

    const close = screen.getByRole('button', { name: 'Close navigation menu' });
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeInTheDocument();
    expect(close).toHaveFocus();
    expect(close).toHaveStyle({ width: '44px', height: '44px' });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('routes recovery to Activity and the metadata claim to Settings', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Recovery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Metadata only' }));
    expect(onNavigate.mock.calls).toEqual([['activity'], ['settings']]);
  });
});
