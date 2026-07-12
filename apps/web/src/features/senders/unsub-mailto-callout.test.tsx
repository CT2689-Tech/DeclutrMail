import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { UnsubMailtoCallout, UnsubMailtoChecklist } from './unsub-mailto-callout';

/**
 * D230 manual-path affordance: the callout must open a PREFILLED Gmail
 * compose (never auto-send), say plainly that the user sends it, and
 * vanish rather than render a broken link for an unparseable mailto.
 */
describe('UnsubMailtoCallout', () => {
  it('renders the compose link prefilled from the mailto URL', () => {
    render(
      <UnsubMailtoCallout
        senderName="LinkedIn"
        mailtoUrl="mailto:unsubscribe@linkedin.example?subject=Unsubscribe%20me"
      />,
    );
    const link = screen.getByRole('link', { name: 'Open Gmail compose' });
    expect(link.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=unsubscribe%40linkedin.example&su=Unsubscribe+me',
    );
    // Opens a new tab — the user finishes there.
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('explains WHY the step is manual (D230 — the list verifies the subscribed address)', () => {
    render(<UnsubMailtoCallout senderName="LinkedIn" mailtoUrl="mailto:u@x.example" />);
    const callout = screen.getByTestId('unsub-mailto-callout');
    expect(callout.textContent).toContain('it must come from your address');
    expect(callout.textContent).toContain('DeclutrMail never sends it for you');
    expect(callout.textContent).toContain('you just hit Send');
  });

  it('dismisses via the close button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    render(
      <UnsubMailtoCallout senderName="X" mailtoUrl="mailto:u@x.example" onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an unparseable mailto (never a broken affordance)', () => {
    const { container } = render(
      <UnsubMailtoCallout senderName="X" mailtoUrl="https://not-a-mailto.example" />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('UnsubMailtoChecklist', () => {
  it('keeps every bulk email request visible until the user opens its Gmail draft', () => {
    render(
      <UnsubMailtoChecklist
        items={[
          { senderName: 'List A', mailtoUrl: 'mailto:leave@a.example' },
          { senderName: 'List B', mailtoUrl: 'mailto:leave@b.example?subject=Remove%20me' },
        ]}
        onDismiss={() => {}}
      />,
    );

    const region = screen.getByRole('region', { name: 'Email unsubscribe drafts' });
    expect(region).toHaveTextContent('2 email unsubscribe drafts still need you');
    expect(region).toHaveTextContent('did not send the email requests');
    expect(screen.getAllByRole('link', { name: 'Open draft' })).toHaveLength(2);
  });

  it('dismisses the checklist explicitly', () => {
    const onDismiss = vi.fn();
    render(
      <UnsubMailtoChecklist
        items={[{ senderName: 'List A', mailtoUrl: 'mailto:leave@a.example' }]}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss email unsubscribe drafts' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
