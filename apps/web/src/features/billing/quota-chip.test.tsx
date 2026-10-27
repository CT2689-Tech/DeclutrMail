import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CleanupSummaryDto } from '@declutrmail/shared/contracts';

import { MeterPreviewLine } from './meter-preview-line';
import { QuotaChip } from './quota-chip';

const METERED: CleanupSummaryDto = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-09T00:00:00.000Z',
};

describe('QuotaChip', () => {
  it('renders nothing when the workspace is not metered', () => {
    const { container } = render(<QuotaChip summary={{ ...METERED, metered: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remaining allowance and turns amber at 80%', () => {
    const { container } = render(<QuotaChip summary={METERED} />);
    expect(screen.getByTestId('quota-chip')).toHaveTextContent(
      '640 emails left to clear · resets Nov 9',
    );
    expect(container.textContent).toContain('resets Nov 9 · See plans');
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveClass('dm-tap-target');
    expect(screen.getByTestId('quota-chip')).toHaveAttribute('data-tone', 'default');

    render(<QuotaChip summary={{ ...METERED, used: 800, remaining: 200 }} />);
    expect(screen.getAllByTestId('quota-chip')[1]).toHaveAttribute('data-tone', 'amber');
  });
});

describe('MeterPreviewLine', () => {
  it('renders nothing when the workspace is not metered', () => {
    const { container } = render(
      <MeterPreviewLine requested={12} summary={{ ...METERED, metered: false }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('states the requested clear against the remaining allowance', () => {
    render(<MeterPreviewLine requested={12} summary={METERED} />);
    expect(screen.getByTestId('meter-preview-line')).toHaveTextContent(
      'This clears 12 emails. You have 640 free this month.',
    );
  });
});
