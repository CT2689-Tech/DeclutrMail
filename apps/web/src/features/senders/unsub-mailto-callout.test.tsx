import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactElement } from 'react';

import { UnsubMailtoCallout } from './unsub-mailto-callout';

/**
 * D230 manual-path affordance: the callout must open a PREFILLED Gmail
 * compose (never auto-send), say plainly that the user sends it, and
 * vanish rather than render a broken link for an unparseable mailto.
 */
describe('UnsubMailtoCallout', () => {
  it('renders the compose link prefilled from the mailto URL', () => {
    renderCallout(
      <UnsubMailtoCallout
        senderId="11111111-1111-4111-8111-111111111111"
        senderName="LinkedIn"
        mailtoUrl="mailto:unsubscribe@linkedin.example?subject=Unsubscribe%20me"
      />,
    );
    const link = screen.getByRole('link', { name: 'Open Gmail draft' });
    expect(link.getAttribute('href')).toBe(
      'https://mail.google.com/mail/?view=cm&fs=1&to=unsubscribe%40linkedin.example&su=Unsubscribe+me',
    );
    // Opens a new tab — the user finishes there.
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('explains WHY the step is manual (D230 — the list verifies the subscribed address)', () => {
    renderCallout(
      <UnsubMailtoCallout
        senderId="11111111-1111-4111-8111-111111111111"
        senderName="LinkedIn"
        mailtoUrl="mailto:u@x.example"
      />,
    );
    const callout = screen.getByTestId('unsub-mailto-callout');
    expect(callout.textContent).toContain('Open the prefilled Gmail draft');
    expect(callout.textContent).toContain('send it yourself');
    expect(callout.textContent).toContain('mark it sent here');
  });

  it('dismisses via the close button when onDismiss is provided', () => {
    const onDismiss = vi.fn();
    renderCallout(
      <UnsubMailtoCallout
        senderId="11111111-1111-4111-8111-111111111111"
        senderName="X"
        mailtoUrl="mailto:u@x.example"
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Gmail unsubscribe reminder' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for an unparseable mailto (never a broken affordance)', () => {
    const { container } = renderCallout(
      <UnsubMailtoCallout
        senderId="11111111-1111-4111-8111-111111111111"
        senderName="X"
        mailtoUrl="https://not-a-mailto.example"
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

function renderCallout(element: ReactElement<ComponentProps<typeof UnsubMailtoCallout>>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
