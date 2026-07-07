/**
 * ScreenerBadge unit tests (D74) — display cap + aria fidelity.
 *
 * The badge renders in a 220px sidebar; a first sync can quarantine
 * thousands of senders, so the RENDERED count caps at "99+" while the
 * aria-label keeps the exact number for assistive tech.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ScreenerBadge } from './screener-badge';

describe('ScreenerBadge', () => {
  it('renders nothing at 0', () => {
    const { container } = render(<ScreenerBadge count={0} />);
    expect(container.textContent).toBe('');
  });

  it('renders the exact count up to 99', () => {
    render(<ScreenerBadge count={99} />);
    expect(screen.getByText('99')).toBeTruthy();
  });

  it('caps the rendered count at 99+ while aria keeps the real number', () => {
    render(<ScreenerBadge count={3198} />);
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByLabelText('3198 new senders waiting in Screener')).toBeTruthy();
  });
});
