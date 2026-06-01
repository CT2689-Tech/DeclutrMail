/**
 * KeyboardCheatsheet tests (§3.1).
 *
 * Asserts the on-demand reveal contract:
 *   1. `?` toggles the overlay open; its rows come from the Action
 *      Registry (ADR-0015) — the four canonical K/A/U/L bindings (D227).
 *   2. Escape closes it.
 *   3. `?` typed into a text field is a literal, never a toggle.
 */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

import { KeyboardCheatsheet, CheatsheetPanel } from './keyboard-cheatsheet';

describe('KeyboardCheatsheet', () => {
  it('is closed until `?` is pressed, then reveals the registry shortcuts', () => {
    render(<KeyboardCheatsheet />);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.keyDown(document.body, { key: '?' });

    const dialog = screen.getByRole('dialog');
    // Verb labels + keys are registry-sourced (D227 K/A/U/L).
    for (const [label, key] of [
      ['Keep', 'K'],
      ['Archive', 'A'],
      ['Unsubscribe', 'U'],
      ['Later', 'L'],
    ] as const) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
      expect(within(dialog).getByText(key)).toBeInTheDocument();
    }
  });

  it('closes on Escape', () => {
    render(<KeyboardCheatsheet />);
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores `?` typed into a text field', () => {
    render(
      <>
        <input aria-label="search" />
        <KeyboardCheatsheet />
      </>,
    );
    const input = screen.getByLabelText('search');
    input.focus();
    fireEvent.keyDown(input, { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('panel close button invokes onClose', () => {
    let closed = false;
    render(<CheatsheetPanel onClose={() => (closed = true)} />);
    fireEvent.click(screen.getByRole('button', { name: /close shortcuts/i }));
    expect(closed).toBe(true);
  });
});
