import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast, ToastHost, usePendingToast } from '@declutrmail/shared';

function Request({ scope }: { scope: string }) {
  const pending = usePendingToast(scope);
  return <button onClick={() => pending('Keeping Acme…')}>Start request</button>;
}

afterEach(cleanup);

describe('request feedback lifetime', () => {
  it('dismisses progress when the owning surface unmounts', () => {
    render(<ToastHost />);
    const owner = render(<Request scope="mailbox-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start request' }));
    expect(screen.getByText('Keeping Acme…')).toBeInTheDocument();
    owner.unmount();
    expect(screen.queryByText('Keeping Acme…')).toBeNull();
  });
  it('does not carry a pending notice into another mailbox', () => {
    render(<ToastHost />);
    const owner = render(<Request scope="mailbox-a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start request' }));
    owner.rerender(<Request scope="mailbox-b" />);
    expect(screen.queryByText('Keeping Acme…')).toBeNull();
  });
});

it('dismisses a notification once its Undo action is used', () => {
  const undo = vi.fn();
  render(<ToastHost />);
  act(() => {
    toast('Kept Acme', 'success', { label: 'Undo', onClick: undo });
  });
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(undo).toHaveBeenCalledOnce();
  expect(screen.queryByText('Kept Acme')).toBeNull();
});
