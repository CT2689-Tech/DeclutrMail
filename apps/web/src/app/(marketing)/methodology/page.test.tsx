import { render, screen } from '@testing-library/react';
import { PRIVACY_NEVER_ITEMS, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { describe, expect, it } from 'vitest';

import MethodologyPage, { metadata } from './page';

describe('/methodology', () => {
  it('renders the complete Gmail message-data boundary and defines Preview text', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    for (const item of [...PRIVACY_STORAGE_ITEMS, ...PRIVACY_NEVER_ITEMS]) {
      expect(copy).toContain(item);
    }
    expect(copy).toContain('Gmail Preview is the short snippet Gmail itself computes');
    expect(copy).toContain('connected account’s identity, preferences, sender decisions');
  });

  it('documents the deterministic recommendation cascade without category prediction', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('deterministic rules over metadata facts');
    expect(copy).toContain('does not use machine learning to predict email categories');
    expect(copy).toContain('When configured, Anthropic may rewrite');
    expect(copy).toContain('does not receive a message subject, Gmail Preview, or full body');
    expect(copy).toContain('deterministic template is the fallback');
  });

  it('states the separate Pro Brief payload boundary without inventing provider terms', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain(
      'send bounded sender identity, subject, and Gmail Preview text to Anthropic',
    );
    expect(copy).toContain(
      'Full message bodies, attachments, inline images, and raw MIME are not sent',
    );
    expect(copy).toContain('makes no claim about Anthropic’s retention or training terms');
    expect(copy).not.toMatch(/Anthropic (?:has |offers |uses )?(?:zero|no) retention/i);
    expect(copy).not.toMatch(/Anthropic (?:does not|never) (?:retain|train)/i);
  });

  it('preserves preview, one-way unsubscribe, and explicit automation boundaries', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('preview is the commitment boundary');
    expect(copy).toContain('result returned by a sender’s unsubscribe endpoint');
    expect(copy).toContain('delivered unsubscribe request cannot be undone');
    expect(copy).toContain('Manual cleanup and future automation are separate concepts');
    expect(copy).toContain('starts them in Observe');
    expect(copy).toContain('switch to Active');
    expect(copy).not.toMatch(/every action (?:is |stays |remains )?(?:reversible|undoable)/i);
  });

  it('uses accessible disclosure and diagram structures', () => {
    const { container } = render(<MethodologyPage />);
    const figures = [...container.querySelectorAll('figure')];

    expect(screen.getAllByText(/For the curious|Where language generation fits/i)).toHaveLength(2);
    expect(container.querySelectorAll('details')).toHaveLength(2);
    expect(figures.length).toBeGreaterThanOrEqual(4);
    for (const figure of figures) {
      expect(figure.querySelector('figcaption')).not.toBeNull();
      expect(figure).toHaveAttribute('aria-labelledby');
    }
  });

  it('publishes canonical social metadata', () => {
    expect(metadata.alternates?.canonical).toBe('/methodology');
    expect((metadata.openGraph as { url?: string }).url).toBe('/methodology');
    expect((metadata.twitter as { card?: string }).card).toBe('summary_large_image');
  });
});
