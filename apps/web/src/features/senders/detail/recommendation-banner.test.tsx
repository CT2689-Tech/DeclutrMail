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
    expect(screen.getByText('Details used')).toBeInTheDocument();
    expect(screen.getByText('12 messages received in the last 30 days')).toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-12: "This suggestion does not change email.
   * Choose the action that fits." was the third statement of that fact on
   * one screen — "Optional suggestion" and the toolbar's own safety hint
   * both already say it.
   */
  it('does not repeat "this suggestion does not change email" a third time', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} />);
    expect(screen.queryByText(/does not change email/i)).not.toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-12: "Suggested action" labelled the
   * reasoning paragraph, which explains the suggestion — not an action.
   */
  it('labels the reasoning paragraph "Why", not "Suggested action"', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} />);
    expect(screen.getByText('Why')).toBeInTheDocument();
    expect(screen.queryByText('Suggested action')).not.toBeInTheDocument();
  });

  /**
   * QA-sender-detail-20260902-07: the toolbar's fact-derived primary verb
   * and this banner's engine suggestion are two independently-sourced
   * signals that can disagree with no explanation of which is which.
   */
  it('names the toolbar highlight when it disagrees with the suggestion', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} toolbarHighlight="later" />);
    expect(screen.getByText(/highlighted button is Later/i)).toBeInTheDocument();
  });

  it('says nothing extra when the toolbar highlight agrees with the suggestion', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} toolbarHighlight="archive" />);
    expect(screen.queryByText(/highlighted button is/i)).not.toBeInTheDocument();
  });

  it('says nothing extra when no toolbar highlight is given', () => {
    render(<RecommendationBanner recommendation={SUGGESTION} />);
    expect(screen.queryByText(/highlighted button is/i)).not.toBeInTheDocument();
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
    // QA-sender-detail-20260902-08: "scored" was the scoring engine's own
    // vocabulary; the shared `scoredAgeLabel` now says "Last checked".
    expect(summary).toHaveTextContent(
      /Last checked .+ ago|Last checked today|Last checked yesterday/,
    );
    expect(summary).not.toHaveTextContent(/scored/i);
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
