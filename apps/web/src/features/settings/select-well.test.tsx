import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SelectWell } from './settings-list';

describe('SelectWell', () => {
  it('stays a native, labelled select that reports the new value', () => {
    const onChange = vi.fn();
    render(
      <SelectWell aria-label="Brief hour" value="8" onChange={(e) => onChange(e.target.value)}>
        <option value="7">7:00 AM</option>
        <option value="8">8:00 AM</option>
      </SelectWell>,
    );
    const select = screen.getByRole('combobox', { name: 'Brief hour' });
    expect(select).toHaveValue('8');
    fireEvent.change(select, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('7');
  });

  it('forwards disabled', () => {
    render(
      <SelectWell aria-label="Brief hour" disabled defaultValue="8">
        <option value="8">8:00 AM</option>
      </SelectWell>,
    );
    expect(screen.getByRole('combobox', { name: 'Brief hour' })).toBeDisabled();
  });
});
