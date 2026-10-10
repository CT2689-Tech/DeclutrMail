import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionPopover } from '@declutrmail/shared';

describe('unavailable sender actions', () => {
  it('shows a reason to keyboard and touch users while blocking clicks and shortcuts', () => {
    const onPick = vi.fn();
    render(
      <ActionPopover
        ariaLabel="Actions for synthetic sender"
        capabilities={{ unsubscribe: false }}
        disabledReasons={{ unsubscribe: 'This sender has no unsubscribe link.' }}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    );
    const unavailable = screen.getByRole('menuitem', { name: /Unsubscribe.*no unsubscribe link/ });
    expect(unavailable).toHaveAttribute('aria-disabled', 'true');
    unavailable.focus();
    expect(unavailable).toHaveFocus();
    fireEvent.click(unavailable);
    fireEvent.keyDown(window, { key: 'u' });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: /^Later/ })).toHaveFocus();
    fireEvent.click(screen.getByRole('menuitem', { name: /^Archive/ }));
    expect(onPick).toHaveBeenCalledWith('archive');
  });
});
