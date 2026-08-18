import { render, screen } from '@testing-library/react';
import { PRIVACY_NEVER_ITEMS, PRIVACY_STORAGE_ITEMS } from '@declutrmail/shared';
import { describe, expect, it } from 'vitest';

import MethodologyPage, { metadata } from './page';

describe('/methodology', () => {
  it('renders the complete Gmail data boundary and explains the preview snippet', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    for (const item of [...PRIVACY_STORAGE_ITEMS, ...PRIVACY_NEVER_ITEMS]) {
      expect(copy).toContain(item);
    }
    expect(copy).toContain('This is the short text Gmail already shows in your inbox list');
    expect(copy).toContain('account information, preferences, decisions, Activity history');
  });

  it('explains suggestions without internal recommendation terminology', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('Suggestions come from clear rules, not guessed categories');
    expect(copy).toContain('does not use machine learning to guess email categories');
    expect(copy).toContain('Anthropic may turn the selected sender facts into a short explanation');
    expect(copy).toContain(
      'does not receive subject lines, preview snippets, or full email contents',
    );
    expect(copy).toContain('DeclutrMail shows a standard explanation');
  });

  it('states what a Pro Brief sends without inventing provider terms', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('send the sender, subject line, and Gmail preview snippet to Anthropic');
    expect(copy).toContain(
      'Full email contents, attachments, embedded images, and raw email source are not sent',
    );
    expect(copy).toContain('Anthropic sets its own retention and training terms');
    expect(copy).not.toMatch(/Anthropic (?:has |offers |uses )?(?:zero|no) retention/i);
    expect(copy).not.toMatch(/Anthropic (?:does not|never) (?:retain|train)/i);
  });

  it('preserves preview, one-way unsubscribe, and explicit automation boundaries', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).toContain('If that preview cannot load, the action cannot run');
    expect(copy).toContain('Activity records the result');
    expect(copy).toContain('Once a one-click request is delivered, DeclutrMail cannot recall it');
    expect(copy).toContain('A manual decision does not create an automatic rule');
    expect(copy).toContain('On Plus, you approve each matching batch');
    expect(copy).toContain('only rules you deliberately turn on');
    expect(copy).not.toMatch(/every action (?:is |stays |remains )?(?:reversible|undoable)/i);
  });

  it('does not expose internal product-writing terms', () => {
    const { container } = render(<MethodologyPage />);
    const copy = container.textContent ?? '';

    expect(copy).not.toMatch(
      /\bmethodology\b|deterministic|cascade|allowlist|payload|mutation|lifecycle/i,
    );
  });

  it('uses accessible disclosure and diagram structures', () => {
    const { container } = render(<MethodologyPage />);
    const figures = [...container.querySelectorAll('figure')];

    expect(
      screen.getAllByText(
        /What the Gmail preview snippet contains|Where language generation fits/i,
      ),
    ).toHaveLength(2);
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
