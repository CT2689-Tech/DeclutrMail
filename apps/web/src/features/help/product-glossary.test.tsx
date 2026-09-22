import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { GLOSSARY_TERMS } from './glossary-content';
import { ProductGlossary } from './product-glossary';

describe('ProductGlossary — D245', () => {
  it('searches definitions, recovers from no matches, and keeps support reachable', () => {
    render(<ProductGlossary />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'Gmail’s separate recovery' },
    });
    expect(screen.getByText('Gmail Trash recovery')).toBeInTheDocument();
    expect(screen.queryByText(GLOSSARY_TERMS.sender.definition)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-such-term' } });
    expect(screen.getByRole('status')).toHaveTextContent('No terms match');
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute(
      'href',
      '#contact-support',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByText(GLOSSARY_TERMS.sender.definition)).toBeInTheDocument();
  });
  it('defines the twelve canonical terms in a semantic glossary', () => {
    const { container } = render(<ProductGlossary />);

    expect(screen.getByRole('heading', { name: 'Help & glossary' })).toBeInTheDocument();
    expect(container.querySelectorAll('section dl dt')).toHaveLength(12);
    expect(container.querySelectorAll('section dl dd')).toHaveLength(12);

    for (const entry of Object.values(GLOSSARY_TERMS)) {
      expect(screen.getAllByText(entry.term).length).toBeGreaterThan(0);
      expect(screen.getAllByText(entry.definition).length).toBeGreaterThan(0);
    }
  });

  it('keeps the high-risk distinctions explicit', () => {
    const { container } = render(<ProductGlossary />);
    const text = container.textContent ?? '';

    expect(screen.getByText(GLOSSARY_TERMS.observe.definition)).toHaveTextContent(
      'without changing Gmail',
    );
    expect(screen.getByText(GLOSSARY_TERMS.observe.definition)).toHaveTextContent(
      'never switches to Active automatically',
    );
    expect(screen.getByText('Watch first')).toBeInTheDocument();
    expect(text).toMatch(/A suggestion never changes Gmail on its own/);
    expect(text).toMatch(/An instruction for future matching email/);
    expect(text).toMatch(/applies its action automatically/);
    expect(text).toMatch(/separate recovery path/);
    expect(text).toMatch(/the return time you choose/);
    expect(text).toMatch(/Future email from the sender is unchanged/);
  });

  it('offers a way back and the public help exit', () => {
    render(<ProductGlossary />);

    expect(screen.getByRole('link', { name: 'Back to Settings' })).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(screen.getByRole('link', { name: 'Help & FAQ' })).toHaveAttribute('href', '/help');
    // Deep-link anchors for decision-point help elsewhere in the app.
    expect(document.getElementById('observe')).not.toBeNull();
  });
});
