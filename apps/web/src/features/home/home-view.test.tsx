import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ApiError } from '@/lib/api/client';
import { HomeView } from './home-view';

const action = { label: 'Review senders', href: '/senders' };

describe('HomeView', () => {
  it('keeps the complete workspace discoverable with clear plan context', () => {
    const ready = {
      kind: 'ready' as const,
      hero: { label: 'emails cleared', value: 12 },
      since: null,
      secondary: [],
      action,
    };
    const { rerender } = render(<HomeView state={ready} tier="plus" />);
    expect(screen.getByRole('link', { name: /Autopilot/ })).toHaveAttribute('href', '/autopilot');
    expect(screen.getByRole('link', { name: /Daily Brief Included with Pro/ })).toHaveAttribute(
      'href',
      '/brief',
    );
    rerender(<HomeView state={ready} tier="pro" />);
    expect(screen.getByRole('link', { name: /Daily Brief/ })).toHaveAttribute('href', '/brief');
    expect(screen.getByRole('link', { name: /Follow-ups/ })).toHaveAttribute('href', '/followups');
    expect(screen.getByRole('link', { name: /Later/ })).toHaveAttribute('href', '/later');
    expect(screen.getByRole('link', { name: /Quiet Hours/ })).toHaveAttribute('href', '/quiet');
  });

  it('ready: recorded progress and the primary next step remain intact', () => {
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
    expect(screen.getByRole('link', { name: /See your activity/ })).toHaveAttribute(
      'href',
      '/activity',
    );
    expect(screen.getByRole('link', { name: /Review 8 today/ })).toHaveAttribute('href', '/triage');
  });

  it('shows real, optional status signals without replacing the next action', () => {
    render(
      <HomeView
        tier="pro"
        workflows={{
          brief: { ready: true, opened: false, replyCount: 3 },
          followups: 2,
          suggestions: 50,
        }}
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 100 },
          since: null,
          secondary: [],
          action: { label: 'Review 4 today', href: '/triage' },
        }}
      />,
    );
    expect(screen.getByRole('link', { name: /Daily Brief 3 replies to consider/ })).toHaveAttribute(
      'href',
      '/brief',
    );
    expect(
      screen.getByRole('link', { name: /Follow-ups 2 conversations waiting/ }),
    ).toHaveAttribute('href', '/followups');
    expect(
      screen.getByRole('link', { name: /Autopilot 50\+ suggestions to review/ }),
    ).toHaveAttribute('href', '/autopilot');
    expect(screen.getByRole('link', { name: /Review 4 today/ })).toHaveAttribute('href', '/triage');
  });

  it('shows current Inbox counts and both pending tasks', () => {
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
            { id: 'sender/1', name: 'A journal', domain: 'journal.example', inboxCount: 4 },
          ],
        }}
      />,
    );
    expect(screen.getByText('In inbox now')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /A journal/ })).toHaveAttribute(
      'href',
      '/senders?sender=sender%2F1',
    );
    expect(screen.getByRole('link', { name: /4 to review today/ })).toHaveAttribute(
      'href',
      '/triage',
    );
    expect(screen.getByRole('link', { name: /3 unreviewed senders/ })).toHaveAttribute(
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
    expect(screen.getByRole('link', { name: /2 unreviewed senders/ })).toBeInTheDocument();
  });

  it('uses singular copy when one sender awaits a first decision', () => {
    render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 1 },
          since: null,
          secondary: [],
          action: { label: 'Review 1 today', href: '/triage' },
          pending: { triagePending: 0, screenerPending: 1 },
          senders: [
            { id: 'sender/1', name: 'A journal', domain: 'journal.example', inboxCount: 1 },
          ],
        }}
      />,
    );
    expect(screen.getByRole('link', { name: /1 unreviewed sender\b/ })).toHaveAttribute(
      'href',
      '/screener',
    );
    expect(screen.getByRole('link', { name: /A journal.*1 email\b/ })).toHaveAttribute(
      'href',
      '/senders?sender=sender%2F1',
    );
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
