import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendationBanner } from './recommendation-banner';
import type { Recommendation } from './types';

const SUGGESTION: Recommendation = {
  verdict: 'archive',
  confidence: 0.99,
  reasoning: 'Archive is suggested from 12 messages received in the last 30 days.',
  signals: ['12 messages received in the last 30 days', '8% marked read in the last 30 days'],
};

describe('RecommendationBanner — D245 optional suggestion', () => {
  it('renders nothing when there is no suggestion', () => {
    const { container } = render(<RecommendationBanner recommendation={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the suggestion collapsed and omits confidence from user-facing copy', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} />);

    const summary = screen.getByText('Optional suggestion · Archive');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText(/confidence/i)).not.toBeInTheDocument();
    expect(screen.getByText('Observed facts')).toBeInTheDocument();
    expect(screen.getByText('12 messages received in the last 30 days')).toBeInTheDocument();
    expect(screen.getByText(/does not change mail/i)).toBeInTheDocument();
  });
});
