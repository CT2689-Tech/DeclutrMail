import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecommendationBanner, scoredAge } from './recommendation-banner';
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
    expect(screen.getByText('Details used')).toBeInTheDocument();
    expect(screen.getByText('12 messages received in the last 30 days')).toBeInTheDocument();
    expect(screen.getByText(/does not change mail/i)).toBeInTheDocument();
  });

  /**
   * Re-scoring is trigger-driven against a 7-day TTL, so a stored verdict
   * is usually months old. The age rides in the collapsed summary — a
   * user who never expands the disclosure still sees how current the
   * read is.
   */
  it('says how old the read is without being expanded', () => {
    render(
      <RecommendationBanner
        recommendation={{ ...SUGGESTION, scoredAt: '2026-05-20T10:00:00.000Z' }}
      />,
    );
    const summary = screen.getByText(/Optional suggestion · Archive/);
    expect(summary).toHaveTextContent(/scored .+ ago|scored today|scored yesterday/);
    expect(summary.closest('details')).not.toHaveAttribute('open');
  });

  it('omits the age when the wire did not carry one', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} />);
    expect(screen.queryByText(/scored/i)).not.toBeInTheDocument();
  });

  it('drops the "Details used" heading when there are no details to list', () => {
    render(<RecommendationBanner recommendation={{ ...SUGGESTION, signals: [] }} />);
    expect(screen.queryByText('Details used')).not.toBeInTheDocument();
    expect(screen.getByText(SUGGESTION.reasoning)).toBeInTheDocument();
  });
});

describe('scoredAge', () => {
  const now = new Date('2026-08-19T12:00:00.000Z');
  const cases: Array<[string, string]> = [
    ['2026-08-19T09:00:00.000Z', 'today'],
    ['2026-08-18T09:00:00.000Z', 'yesterday'],
    ['2026-08-15T12:00:00.000Z', '4 days ago'],
    ['2026-08-11T12:00:00.000Z', 'a week ago'],
    // 26 days — still weeks; 30 days crosses into the months branch.
    ['2026-07-24T12:00:00.000Z', '4 weeks ago'],
    ['2026-07-20T12:00:00.000Z', 'a month ago'],
    ['2026-05-20T12:00:00.000Z', '3 months ago'],
    ['2025-08-19T12:00:00.000Z', 'a year ago'],
  ];
  it.each(cases)('renders %s as %s', (iso, expected) => {
    expect(scoredAge(iso, now)).toBe(expected);
  });

  it('says nothing for an unparseable or future timestamp', () => {
    expect(scoredAge('not-a-date', now)).toBeNull();
    expect(scoredAge('2026-09-01T00:00:00.000Z', now)).toBeNull();
  });
});
