import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/client';
import { HomeView } from './home-view';

const action = { label: 'Review senders', href: '/senders' };

describe('HomeView', () => {
  it('ready: one hero number, its label, the secondary row and one link', () => {
    render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 1234 },
          since: '2026-03-15T12:00:00.000Z',
          secondary: [
            { label: 'Emails archived', value: 1200 },
            { label: 'Emails deleted', value: 34 },
          ],
          action: { label: 'Review 8 today', href: '/triage' },
        }}
      />,
    );
    expect(screen.getByTestId('home-hero')).toHaveTextContent('1,234');
    expect(screen.getByText(/emails cleared since Mar 2026/)).toBeInTheDocument();
    expect(screen.getByText('Emails archived')).toBeInTheDocument();
    expect(screen.getByText('34')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(screen.getByRole('link', { name: /See your activity/ })).toHaveAttribute(
      'href',
      '/activity',
    );
    expect(links[0]).toHaveAttribute('href', '/triage');
    expect(links[0]).toHaveTextContent('Review 8 today');
  });

  it('shows served sender counts with their actual window and both pending tasks', () => {
    render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 100 },
          since: null,
          secondary: [{ label: 'Senders decided', value: 2 }],
          action,
          pending: { triagePending: 4, screenerPending: 3 },
          senders: [
            { id: 'sender/1', name: 'A journal', domain: 'journal.example', recentCount: 21 },
          ],
        }}
      />,
    );
    expect(screen.getByText('Last 90 days')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /A journal/ })).toHaveAttribute(
      'href',
      '/senders?sender=sender%2F1',
    );
    expect(screen.getByRole('link', { name: /4 to review today/ })).toHaveAttribute(
      'href',
      '/triage',
    );
    expect(screen.getByRole('link', { name: /3 new senders/ })).toHaveAttribute(
      'href',
      '/screener',
    );
    expect(screen.getByText('Senders decided')).toBeInTheDocument();
  });

  it('keeps the primary review destination out of the attention list', () => {
    render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 100 },
          since: null,
          secondary: [],
          action: { label: 'Review 4 today', href: '/triage' },
          pending: { triagePending: 4, screenerPending: 2 },
        }}
      />,
    );
    expect(
      screen.getAllByRole('link').filter((link) => link.getAttribute('href') === '/triage'),
    ).toHaveLength(1);
    expect(screen.getByRole('link', { name: /2 new senders/ })).toBeInTheDocument();
  });

  it('ready without secondary stats renders no stat row', () => {
    const { container } = render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'senders decided', value: 3 },
          since: null,
          secondary: [],
          action,
        }}
      />,
    );
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.getByText('senders decided')).toBeInTheDocument();
  });

  it('empty: no number at all — a title and the link', () => {
    render(<HomeView state={{ kind: 'empty', syncing: false, action }} />);
    expect(screen.queryByTestId('home-hero')).toBeNull();
    expect(screen.getByText('Nothing cleared yet')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/senders');
  });

  it('empty while the mailbox is still syncing says so', () => {
    render(<HomeView state={{ kind: 'empty', syncing: true, action }} />);
    expect(screen.getByText('Reading your inbox')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet')).toBeNull();
  });

  it('sync-failed: says the scan failed and links to Gmail accounts — never "Nothing cleared yet"', () => {
    render(<HomeView state={{ kind: 'sync-failed' }} />);
    expect(screen.getByText('Gmail scan failed')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet')).toBeNull();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/settings#mailboxes');
  });

  it('loading: a labelled skeleton and no link', () => {
    render(<HomeView state={{ kind: 'loading' }} />);
    expect(screen.getByRole('status', { name: 'Loading Home' })).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('error: names the cause and retries', () => {
    const retry = vi.fn();
    render(<HomeView state={{ kind: 'error', error: new ApiError(500, null, 'boom'), retry }} />);
    expect(screen.getByText(/couldn't load Home/)).toBeInTheDocument();
    expect(screen.getByText(/server returned an error/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
