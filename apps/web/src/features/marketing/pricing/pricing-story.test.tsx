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
    expect(screen.getByTestId('pricing-story').textContent).toContain('$0');

    const passLines = [
      'No monthly limit for 30 days',
      'The Screener and Autopilot while it lasts',
      'Buy again any time to add 30 more days',
      'Then you’re back on Free. Email you cleared stays where you put it.',
    ];
    const items = within(passCard!).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(passLines);
    expect(passCard?.textContent).not.toContain('{passDays}');
    expect(passCard?.textContent).not.toContain('{freeName}');
    expect(items[0]?.querySelector('svg')).not.toBeNull();

    const promise = screen.getByTestId('price-promise');
    const refunds = within(promise).getAllByText(/14-day money-back on any purchase/);
    expect(refunds).toHaveLength(1);
    expect(screen.getByText(/^Launch offer:/)).toBeInTheDocument();
  });

  it.each(['usd', 'inr'] as const)(
    'keeps India prices and omits the UPI pay line for %s visitors',
    (locale) => {
      for (const passEnabled of [true, false]) {
        const view = render(<PricingStory passEnabled={passEnabled} locale={locale} now={NOW} />);
        expect(
          screen.getByRole('heading', { name: 'What do you charge in India?' }),
        ).toBeInTheDocument();
        expect(view.container.textContent).toMatch(/rupees and include GST/);
        expect(view.container.textContent).not.toMatch(/You can pay with UPI/);
        if (locale === 'inr') {
          expect(view.container.textContent).not.toContain('$');
          expect(view.container.textContent).toContain('₹1,999');
          expect(view.container.textContent).toMatch(/a year/);
        }
        view.unmount();
      }
    },
  );
});
