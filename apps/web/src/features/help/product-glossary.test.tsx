import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { GLOSSARY_TERMS } from './glossary-content';
import { ProductGlossary } from './product-glossary';

describe('ProductGlossary — D245', () => {
  it('defines the nine canonical terms in a semantic glossary', () => {
    const { container } = render(<ProductGlossary />);

    expect(screen.getByRole('heading', { name: 'Product glossary' })).toBeInTheDocument();
    expect(container.querySelectorAll('section dl dt')).toHaveLength(9);
    expect(container.querySelectorAll('section dl dd')).toHaveLength(9);

    for (const entry of Object.values(GLOSSARY_TERMS)) {
      expect(screen.getAllByText(entry.term).length).toBeGreaterThan(0);
      expect(screen.getAllByText(entry.definition).length).toBeGreaterThan(0);
    }
  });

  it('keeps the high-risk distinctions explicit', () => {
    const { container } = render(<ProductGlossary />);
    const text = container.textContent ?? '';

    expect(text).toMatch(/does not change Gmail/);
    expect(text).toMatch(/applies its action automatically/);
    expect(text).toMatch(/Activity Undo or Gmail Trash recovery/);
    expect(text).toMatch(/separate recovery path/);
    expect(text).toMatch(/required wake time/);
    expect(text).toMatch(/Future mail from the sender is unchanged/);
  });

  it('offers topic navigation, contextual disclosures, and specific exits', () => {
    render(<ProductGlossary />);

    const nav = screen.getByRole('navigation', { name: 'Glossary topics' });
    expect(within(nav).getByRole('link', { name: 'Autopilot modes' })).toHaveAttribute(
      'href',
      '#observe',
    );
    expect(screen.getByText('Protected or VIP — which should I use?').closest('details')).not.toBe(
      null,
    );
    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('link', { name: 'Help & FAQ' })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: 'support@declutrmail.com' })).toHaveAttribute(
      'href',
      'mailto:support@declutrmail.com',
    );
  });
});
