import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
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

/** QA-billing-20260901-11 — a caller whose first-in-DOM element is a
 *  consequential action can redirect initial focus to a safer one. */
function TrapWithPreferredFocus({ active }: { active: boolean }) {
  const ref = useFocusTrap<HTMLDivElement>(active, {
    initialFocusSelector: '#safe-default',
  });
  return (
    <div ref={ref} role="dialog" aria-label="Example dialog with a preferred default">
      <button>Mutating first action</button>
      <button id="safe-default">Safe default</button>
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

  it('honors initialFocusSelector over DOM order when a caller supplies one', async () => {
    const { rerender } = render(
      <>
        <button>Open example</button>
        <TrapWithPreferredFocus active={false} />
      </>,
    );
    screen.getByRole('button', { name: 'Open example' }).focus();

    rerender(
      <>
        <button>Open example</button>
        <TrapWithPreferredFocus active />
      </>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'Safe default' })).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Mutating first action' })).not.toHaveFocus();
  });
});
