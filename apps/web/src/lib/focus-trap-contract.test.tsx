import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useFocusTrap } from '@declutrmail/shared';
import { describe, expect, it } from 'vitest';

function Trap({ active }: { active: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div ref={ref} role="dialog" aria-label="Example dialog">
      <button>First action</button>
      <button>Last action</button>
    </div>
  );
}

describe('useFocusTrap accessibility contract', () => {
  it('moves focus in, wraps both Tab directions, and restores the trigger', async () => {
    const { rerender } = render(
      <>
        <button>Open example</button>
        <Trap active={false} />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Open example' });
    trigger.focus();

    rerender(
      <>
        <button>Open example</button>
        <Trap active />
      </>,
    );

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    const dialog = screen.getByRole('dialog', { name: 'Example dialog' });
    await waitFor(() => expect(first).toHaveFocus());

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();

    rerender(
      <>
        <button>Open example</button>
        <Trap active={false} />
      </>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open example' })).toHaveFocus());
  });
});
