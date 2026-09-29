import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from './switch';

describe('Switch', () => {
  it('exposes its state and asks for the opposite one', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} ariaLabel="Quiet hours" />);
    const sw = screen.getByRole('switch', { name: 'Quiet hours' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing while disabled', () => {
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} ariaLabel="Quiet hours" disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
