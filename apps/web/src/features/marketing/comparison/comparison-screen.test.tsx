import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import { COMPARISONS, comparisonBySlug } from './comparison-data';
import { ComparisonDetailScreen, ComparisonIndexScreen } from './comparison-screen';

describe('ComparisonIndexScreen', () => {
  beforeEach(() => track.mockClear());

  it('renders all five comparison routes and the verification standard', () => {
    render(<ComparisonIndexScreen />);

    expect(screen.getByText(/Last verified July 2026/i)).toBeInTheDocument();
    expect(screen.getByText(/No affiliate rankings/i)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scrollable comparison summary' })).toHaveAttribute(
      'tabindex',
      '0',
    );
    for (const comparison of COMPARISONS) {
      expect(
        screen.getByRole('link', { name: `Compare DeclutrMail and ${comparison.name}` }),
      ).toHaveAttribute('href', `/vs/${comparison.slug}`);
    }
  });

  it('labels unknown public pricing instead of showing an invented amount', () => {
    render(<ComparisonIndexScreen />);
    expect(
      screen.getAllByText(/Not publicly stated on reviewed product pages/i).length,
    ).toBeGreaterThan(0);
  });

  it('tracks both lower-funnel choices in the final comparison CTA', () => {
    render(<ComparisonIndexScreen />);

    fireEvent.click(screen.getByRole('link', { name: /Connect Gmail/i }));
    fireEvent.click(screen.getByRole('link', { name: 'See every tier' }));

    expect(track).toHaveBeenNthCalledWith(1, 'landing_cta_clicked', {
      cta: 'connect_gmail',
      placement: 'final',
    });
    expect(track).toHaveBeenNthCalledWith(2, 'landing_cta_clicked', {
      cta: 'see_pricing',
      placement: 'final',
    });
  });
});

describe('ComparisonDetailScreen', () => {
  beforeEach(() => track.mockClear());

  it.each(COMPARISONS.map((comparison) => [comparison.name, comparison] as const))(
    'renders balanced guidance, eight decisions, and sources for %s',
    (_name, comparison) => {
      const { unmount } = render(<ComparisonDetailScreen comparison={comparison} />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        `DeclutrMail vs ${comparison.name}`,
      );
      expect(screen.getByText(`A strong reason to choose ${comparison.name}`)).toBeInTheDocument();
      expect(screen.getByText('A strong reason to choose DeclutrMail')).toBeInTheDocument();

      const table = screen.getByRole('table', {
        name: `Feature comparison between DeclutrMail and ${comparison.name}`,
      });
      expect(
        screen.getByRole('region', {
          name: `Scrollable comparison of DeclutrMail and ${comparison.name}`,
        }),
      ).toHaveAttribute('tabindex', '0');
      expect(within(table).getAllByRole('row')).toHaveLength(comparison.rows.length + 1);

      for (const source of comparison.sources) {
        expect(screen.getByRole('link', { name: source.label })).toHaveAttribute(
          'href',
          source.url,
        );
      }

      unmount();
    },
  );

  it('renders a visible unknown state and does not disguise it as unsupported', () => {
    const comparison = comparisonBySlug('trimbox')!;
    render(<ComparisonDetailScreen comparison={comparison} />);

    expect(screen.getAllByText('Not publicly stated').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Trimbox does not offer automation/i)).not.toBeInTheDocument();
  });
});
