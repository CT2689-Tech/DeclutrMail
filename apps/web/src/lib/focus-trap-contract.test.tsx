import { createRef, type RefObject } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useFocusTrap } from '@declutrmail/shared/hooks/use-focus-trap';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

function DelayedTrap({
  active,
  opener,
}: {
  active: boolean;
  opener: RefObject<HTMLButtonElement | null>;
}) {
  const ref = useFocusTrap<HTMLDivElement>(active, { returnFocusRef: opener });
  return active ? (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Review">
      <button>Close review</button>
    </div>
  ) : null;
}

function NextModal() {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Next dialog">
      <button>Next safe control</button>
    </div>
  );
}

describe('delayed return-focus ownership', () => {
  afterEach(() => vi.restoreAllMocks());

  function holdFrames() {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    return frames;
  }

  it('leaves focus in a new modal when the previous disabled opener becomes enabled', async () => {
    const frames = holdFrames();
    const opener = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <div>
        <button ref={opener} disabled>
          Open review
        </button>
        <DelayedTrap active opener={opener} />
      </div>,
    );
    rerender(
      <div>
        <button ref={opener} disabled>
          Open review
        </button>
        <DelayedTrap active={false} opener={opener} />
      </div>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames).toHaveLength(1);
    rerender(
      <div>
        <button ref={opener}>Open review</button>
        <DelayedTrap active={false} opener={opener} />
        <NextModal />
      </div>,
    );
    expect(screen.getByRole('button', { name: 'Next safe control' })).toHaveFocus();
    act(() => frames[0]!(0));
    expect(screen.getByRole('button', { name: 'Next safe control' })).toHaveFocus();
  });

  it('cancels a stale return when the same trap opens again', async () => {
    const frames = holdFrames();
    const opener = createRef<HTMLButtonElement>();
    const view = (active: boolean, disabled: boolean) => (
      <div>
        <button ref={opener} disabled={disabled}>
          Open review
        </button>
        <DelayedTrap active={active} opener={opener} />
      </div>
    );
    const { rerender } = render(view(true, true));
    rerender(view(false, true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(frames).toHaveLength(1);
    rerender(view(true, false));
    expect(screen.getByRole('button', { name: 'Close review' })).toHaveFocus();
    act(() => frames[0]!(0));
    expect(screen.getByRole('button', { name: 'Close review' })).toHaveFocus();
  });

  it('still returns to an opener that enables after close when focus has no new owner', async () => {
    const frames = holdFrames();
    const opener = createRef<HTMLButtonElement>();
    const view = (active: boolean, disabled: boolean) => (
      <div>
        <button ref={opener} disabled={disabled}>
          Open review
        </button>
        <DelayedTrap active={active} opener={opener} />
      </div>
    );
    const { rerender } = render(view(true, true));
    rerender(view(false, true));
    await act(async () => {
      await Promise.resolve();
    });
    rerender(view(false, false));
    act(() => frames[0]!(0));
    expect(opener.current).toHaveFocus();
  });
});
