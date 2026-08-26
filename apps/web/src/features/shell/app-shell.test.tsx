import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AppShell } from '@declutrmail/shared';

describe('AppShell interactions', () => {
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

  it('routes Undo windows to Activity and Stored Gmail data to Settings', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo windows' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stored Gmail data' }));
    expect(onNavigate.mock.calls).toEqual([['activity'], ['settings']]);
  });

  it('signals navigation intent from pointer, keyboard, and touch without firing the click', () => {
    const onNavigate = vi.fn();
    const onNavigateIntent = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate} onNavigateIntent={onNavigateIntent}>
        <div>Page content</div>
      </AppShell>,
    );

    const triage = screen.getByRole('button', { name: 'Triage' });
    fireEvent.mouseEnter(triage);
    fireEvent.focus(triage);
    fireEvent.touchStart(triage);

    expect(onNavigateIntent.mock.calls).toEqual([['triage'], ['triage'], ['triage']]);
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Senders' }));
    expect(onNavigateIntent).toHaveBeenCalledTimes(3);
  });
});
