/**
 * ComposeStrip DomainMenu typing regression (D38).
 *
 * Founder-reported 2026-07-04: the domain popover accepted only ONE
 * letter. Cause: focus/select lived in the same effect as the
 * outside-click listener, whose deps include `draft` — so `select()`
 * re-ran per keystroke, highlighting the whole input, and the next key
 * replaced it. The multi-character test below fails against that code.
 *
 * Typed with @testing-library/user-event (per-key events flush effects
 * between keystrokes, so a per-keystroke select() is visible here);
 * the sibling sender-search bug additionally needed Playwright because
 * its mechanism was host-render latency, which jsdom can't exhibit.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ComposeStrip, EMPTY_COMPOSE } from './compose-strip';

function renderStrip(onChange = vi.fn()) {
  render(
    <ComposeStrip
      state={EMPTY_COMPOSE}
      counts={undefined}
      onChange={onChange}
      onClear={vi.fn()}
      sort="total"
      direction="desc"
      onSortChange={vi.fn()}
      domainSuggestions={['amazon.com', 'linkedin.com']}
    />,
  );
  return { onChange };
}

describe('ComposeStrip · DomainMenu', () => {
  it('accepts a full multi-character domain, not just one letter', async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(screen.getByRole('button', { name: /domain/i }));
    const input = screen.getByPlaceholderText(/amazon\.com/);

    await user.type(input, 'bankofamerica');

    expect(input).toHaveValue('bankofamerica');
  });

  it('commits the typed domain on Enter', async () => {
    const user = userEvent.setup();
    const { onChange } = renderStrip();

    await user.click(screen.getByRole('button', { name: /domain/i }));
    await user.type(screen.getByPlaceholderText(/amazon\.com/), 'Chase.com{Enter}');

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ domain: 'chase.com' }));
  });
});
