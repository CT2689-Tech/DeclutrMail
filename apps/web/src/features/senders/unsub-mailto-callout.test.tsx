import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComponentProps, ReactElement } from 'react';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({
    me: {
      user: { email: 'default@example.com' },
      activeMailboxId: 'mailbox-newsletters',
      mailboxes: [
        { id: 'mailbox-default', email: 'default@example.com', status: 'active' },
        {
          id: 'mailbox-newsletters',
          email: 'newsletters+declutr@example.com',
          status: 'active',
        },
      ],
    },
  }),
  getActiveMailboxEmail: (me: {
    activeMailboxId: string;
    mailboxes: Array<{ id: string; email: string }>;
    user: { email: string };
  }) => me.mailboxes.find((mailbox) => mailbox.id === me.activeMailboxId)?.email ?? me.user.email,
}));

import { UnsubMailtoCallout, UnsubMailtoChecklist } from './unsub-mailto-callout';

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
      'https://mail.google.com/mail/?authuser=newsletters%2Bdeclutr%40example.com&view=cm&fs=1&to=unsubscribe%40linkedin.example&su=Unsubscribe+me',
    );
    expect(link.getAttribute('href')).not.toContain('/u/0');
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
    for (const link of screen.getAllByRole('link', { name: 'Open draft' })) {
      expect(link.getAttribute('href')).toContain('authuser=newsletters%2Bdeclutr%40example.com');
      expect(link.getAttribute('href')).not.toContain('/u/0');
    }
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
