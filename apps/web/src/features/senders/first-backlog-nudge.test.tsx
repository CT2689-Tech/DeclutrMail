import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FirstBacklogNudge } from './first-backlog-nudge';

it('keeps the directory search and filters on the starter card link', () => {
  const client = new QueryClient();
  client.setQueryData(['senders', 'first-backlog'], {
    senderId: 'weekly',
    name: 'Weekly',
    inboxEmails: 2,
  });
  render(
    <QueryClientProvider client={client}>
      <FirstBacklogNudge detailSearch="q=weekly&has_inbox_mail=true&sort=name&sender=weekly" />
    </QueryClientProvider>,
  );
  const href = screen.getByRole('link', { name: 'Open a sender' }).getAttribute('href');
  const url = new URL(href!, 'https://app.example');
  expect(url.pathname).toBe('/senders/weekly');
  expect(url.searchParams.get('returnTo')).toBe('/senders?q=weekly&has_inbox_mail=true&sort=name');
  client.clear();
});
