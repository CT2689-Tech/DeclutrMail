import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HOME_DECK } from '@/features/home/home-deck-copy';

import { MeterPreviewSlot } from './meter-preview-slot';

const metered = {
  metered: true,
  limit: 1000,
  used: 360,
  remaining: 640,
  resetAt: '2026-11-01T00:00:00.000Z',
};

describe('MeterPreviewSlot', () => {
  it('stays empty until a metered summary exists', () => {
    const { container } = render(<MeterPreviewSlot requested={12} summary={null} />);
    expect(container).toBeEmptyDOMElement();
    const { container: unmetered } = render(
      <MeterPreviewSlot requested={12} summary={{ ...metered, metered: false }} />,
    );
    expect(unmetered).toBeEmptyDOMElement();
  });

  it('states the email count from the server summary', () => {
    render(<MeterPreviewSlot requested={12} summary={metered} />);
    expect(
      screen.getByText('This clears 12 emails. You have 640 free this month.'),
    ).toBeInTheDocument();
  });

  it('uses the free sentence for an unsubscribe that moves no mail', () => {
    render(<MeterPreviewSlot requested={null} summary={metered} freeUnsubscribe />);
    expect(screen.getByText(HOME_DECK.previewFree)).toBeInTheDocument();
    expect(screen.queryByText(/clears 0/)).not.toBeInTheDocument();
  });
});
