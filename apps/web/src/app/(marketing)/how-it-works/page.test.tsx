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
    expect(copy).toContain('Manual cleanup changes only the preview you confirm');
    expect(copy).toContain('activated Pro rules are a separate future-mail path');
  });

  it('maps every action to honest current-mail and future-mail semantics', () => {
    const { container } = render(<HowItWorksPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('Keep is not Protect');
    expect(copy).toContain('chosen sender-level return time');
    expect(copy).toContain('DeclutrMail/Later');
    expect(copy).toContain('cannot be recalled');
    expect(copy).toContain('Delete is available from Senders and Sender Detail');
    expect(copy).toContain('does not quietly decide what happens to future mail');
    expect(copy).toContain('starts in Observe');
    expect(copy).toContain('switch it to Active');
  });

  it('labels the walkthrough synthetic and makes each conceptual diagram accessible', () => {
    const { container } = render(<HowItWorksPage />);
    const figures = [...container.querySelectorAll('figure')];

    expect(screen.getByText(/Synthetic walkthrough/i)).toBeInTheDocument();
    expect(
      screen.getByRole('table', { name: 'How each DeclutrMail choice maps to Gmail' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'How each DeclutrMail choice maps to Gmail' }),
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
