import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HowItWorksPage, { metadata } from './page';

describe('/how-it-works', () => {
  it('keeps Gmail as the mail surface and explains the sender-control split', () => {
    const { container } = render(<HowItWorksPage />);
    const copy = container.textContent ?? '';

    expect(
      screen.getByRole('heading', { level: 1, name: 'A sender-control layer for Gmail.' }),
    ).toBeInTheDocument();
    expect(copy).toContain('Gmail remains where you read, reply, compose, and search');
    expect(copy).toContain('companion to Gmail, not a replacement email client');
    expect(copy).toContain('Recent subject links return to Gmail');
    expect(copy).toContain('Manual actions affect only the email shown before you confirm');
    expect(copy).toContain('Autopilot rules are separate and must be turned on');
  });

  it('maps every action to honest current-mail and future-mail semantics', () => {
    const { container } = render(<HowItWorksPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('Keep is not Protect');
    expect(copy).toContain('return time you choose');
    expect(copy).toContain('DeclutrMail/Later');
    expect(copy).toContain('cannot be undone');
    // Was "Delete is available from Senders and Sender Detail" — true
    // until the 2026-08-06 amendment to ADR-0019 put Delete on the Triage
    // toolbar too. The guard is unchanged in intent: this page must state
    // the two properties that make a destructive verb safe to show, so
    // assert those rather than where the button happens to live.
    expect(copy).toContain('Delete is never recommended for you');
    expect(copy).toContain('always shows a full preview first');
    expect(copy).toContain('does not quietly decide what happens to future mail');
    // The page taught "starts in Observe … switch it to Active",
    // which described a flow the app dropped on 2026-08-23. What must
    // still hold is the automation BOUNDARY: nothing runs unless the
    // user turned it on, and they saw what it would do first.
    expect(copy).toContain('only a rule you deliberately turn on acts without asking');
    expect(copy).toContain('Turning a preset on shows what it would do first');
    expect(copy).not.toContain('starts in Observe');
  });

  it('labels the walkthrough as made up and makes each conceptual diagram accessible', () => {
    const { container } = render(<HowItWorksPage />);
    const figures = [...container.querySelectorAll('figure')];

    expect(screen.getByText(/Made-up walkthrough/i)).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'How each DeclutrMail decision maps to Gmail' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'How each DeclutrMail decision maps to Gmail' }),
    ).toBeInTheDocument();
    expect(figures.length).toBeGreaterThanOrEqual(3);
    for (const figure of figures) {
      expect(figure.querySelector('figcaption')).not.toBeNull();
      expect(figure).toHaveAttribute('aria-labelledby');
    }
    expect(container.querySelector('header header')).toBeNull();
  });

  it('does not make a blanket reversibility promise', () => {
    const { container } = render(<HowItWorksPage />);
    const copy = container.textContent ?? '';

    expect(copy).not.toMatch(/every action (?:is |stays |remains )?(?:reversible|undoable)/i);
    expect(copy).not.toMatch(/all actions (?:are |stay |remain )?(?:reversible|undoable)/i);
  });

  it('publishes canonical social metadata', () => {
    expect(metadata.alternates?.canonical).toBe('/how-it-works');
    expect((metadata.openGraph as { url?: string }).url).toBe('/how-it-works');
    expect((metadata.twitter as { card?: string }).card).toBe('summary_large_image');
  });
});
