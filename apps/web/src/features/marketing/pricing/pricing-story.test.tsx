import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PricingStory } from './pricing-story';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn(() => Promise.resolve()) }));

const NOW = '2026-10-27T07:01:00.000Z';

describe('PricingStory', () => {
  it('shows one unit, a check glyph, and the refund sentence once', () => {
    render(<PricingStory passEnabled locale="usd" now={NOW} />);

    const cards = screen.getAllByRole('article');
    const passCard = cards.find((card) => card.getAttribute('data-plan') === 'pass');
    const plusCard = cards.find((card) => card.getAttribute('data-plan') === 'plus');
    expect(passCard).toBeDefined();
    expect(plusCard).toBeDefined();
    expect(passCard).toHaveTextContent('$19');
    expect(passCard).toHaveTextContent('once');
    expect(passCard?.textContent).not.toMatch(/once once/);
    expect(plusCard).toHaveTextContent('$59');
    expect(plusCard).toHaveTextContent('a year');
    expect(plusCard?.textContent).not.toMatch(/a year a year/);

    const feature = within(passCard!).getByText('Everything in Plus for 30 days');
    expect(feature.closest('li')?.querySelector('svg')).not.toBeNull();

    const promise = screen.getByTestId('price-promise');
    const refunds = within(promise).getAllByText(/14-day money-back on any purchase/);
    expect(refunds).toHaveLength(1);
    expect(screen.getByText(/^Launch offer:/)).toBeInTheDocument();
  });
});
