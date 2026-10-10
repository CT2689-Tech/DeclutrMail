import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { ApiError } from '@/lib/api/client';
import { HomeView } from './home-view';

const action = { label: 'Review senders', href: '/senders' };

describe('HomeView', () => {
  it('formats the cleanup month in an explicit timezone on either side of hydration', () => {
    const state = {
      kind: 'ready' as const,
      hero: { label: 'emails cleared', value: 12 },
      since: '2026-01-01T00:00:00.000Z',
      secondary: [],
      action,
    };
    const { rerender } = render(<HomeView state={state} />);
    expect(screen.getByRole('region', { name: 'Your cleanup so far' })).toHaveTextContent(
      'emails cleared since Jan 2026',
    );
    rerender(<HomeView state={state} timeZone="America/Los_Angeles" />);
    expect(screen.getByRole('region', { name: 'Your cleanup so far' })).toHaveTextContent(
      'emails cleared since Dec 2025',
    );
  });

  it('keeps the complete workspace discoverable with clear plan context', () => {
    const ready = {
      kind: 'ready' as const,
      hero: { label: 'emails cleared', value: 12 },
      since: null,
      secondary: [],
      action,
    };
    const { rerender } = render(<HomeView state={ready} tier="plus" />);
    // Anchored: the Quiet tile's own detail text now says "...Autopilot
    // holds its actions", so an unanchored /Autopilot/ matches both tiles.
    expect(screen.getByRole('link', { name: /^Autopilot/ })).toHaveAttribute('href', '/autopilot');
    expect(screen.getByRole('link', { name: /Daily brief Included with Pro/ })).toHaveAttribute(
      'href',
      '/brief',
    );
    rerender(<HomeView state={ready} tier="pro" />);
    expect(screen.getByRole('link', { name: /Daily brief/ })).toHaveAttribute('href', '/brief');
    expect(screen.getByRole('link', { name: /Follow-ups/ })).toHaveAttribute('href', '/followups');
    expect(screen.getByRole('link', { name: /Later/ })).toHaveAttribute('href', '/later');
    expect(screen.getByRole('link', { name: /Quiet hours/ })).toHaveAttribute('href', '/quiet');
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
    expect(screen.getByRole('region', { name: 'Your cleanup so far' })).toHaveTextContent(
      'emails cleared since Mar 2026',
    );
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
    expect(screen.getByRole('link', { name: /Daily brief 3 replies to consider/ })).toHaveAttribute(
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
    expect(screen.getByText('Nothing cleared yet.')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/senders');
  });

  it('empty while the mailbox is still syncing says so', () => {
    render(<HomeView state={{ kind: 'empty', syncing: true, action }} />);
    expect(screen.getByText('Reading your Gmail.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
  });

  it('sync-failed: says the scan failed and links to Gmail accounts — never "Nothing cleared yet"', () => {
    render(<HomeView state={{ kind: 'sync-failed', needsReconnect: false }} />);
    expect(screen.getByText('Gmail scan failed.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing cleared yet.')).toBeNull();
    expect(screen.queryByTestId('home-hero')).toBeNull();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/settings#mailboxes');
  });

  it('sync-failed: blames the connection only when the grant is what failed', () => {
    // A scan also stops on Gmail throttling or a Google error; Settings
    // offers a retry for those, and "review the connection" sent those
    // users looking for a problem that was not there.
    const { unmount } = render(<HomeView state={{ kind: 'sync-failed', needsReconnect: false }} />);
    expect(screen.queryByText(/connection/i)).toBeNull();
    expect(screen.getByText(/Scan again in Settings/)).toBeInTheDocument();
    unmount();

    render(<HomeView state={{ kind: 'sync-failed', needsReconnect: true }} />);
    expect(screen.getByText(/Reconnect it in Settings/)).toBeInTheDocument();
    expect(screen.queryByText(/Scan again/)).toBeNull();
  });

  it.each([false, true])(
    'sync-failed: says exactly what failedScanSettingsStep says (needsReconnect=%s)',
    (needsReconnect) => {
      // Inline in the view for the bundle budget; pinned to the helper the
      // toast and Triage use so the surfaces cannot drift apart.
      render(<HomeView state={{ kind: 'sync-failed', needsReconnect }} />);
      expect(screen.getByText(failedScanSettingsStep(needsReconnect))).toBeInTheDocument();
    },
  );

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

describe('Home primary task hierarchy', () => {
  it.each([
    ['/triage', 'Review 8 today'],
    ['/screener', 'Review 4 new'],
  ])('places %s review before recorded history in reading order', (href, label) => {
    const { container } = render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 100 },
          since: null,
          secondary: [],
          action: { href, label },
        }}
      />,
    );
    const primary = screen.getByRole('link', { name: new RegExp(label) });
    const stamp = screen.getByRole('region', { name: 'Your cleanup so far' });
    expect(primary.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.firstElementChild).toHaveAttribute('data-home-priority', 'review');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A little room');
  });
  it('keeps calm introductory framing when no review task is waiting', () => {
    const { container } = render(
      <HomeView
        state={{
          kind: 'ready',
          hero: { label: 'emails cleared', value: 100 },
          since: null,
          secondary: [],
          action,
          pending: { triagePending: 0, screenerPending: 0 },
        }}
      />,
    );
    const primary = screen.getByRole('link', { name: /Review senders/ });
    const stamp = screen.getByRole('region', { name: 'Your cleanup so far' });
    expect(primary.compareDocumentPosition(stamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.firstElementChild).toHaveAttribute('data-home-priority', 'intro');
  });
  it('uses the compact intro for a first review without implying an incomplete scan is ready', () => {
    const first = {
      kind: 'empty' as const,
      syncing: false,
      action: { label: 'Review 2 today', href: '/triage' },
      senders: [{ id: 'a', name: 'A sender', domain: 'synthetic.test', inboxCount: 2 }],
    };
    const { container, rerender } = render(<HomeView state={first} />);
    expect(container.firstElementChild).toHaveAttribute('data-home-priority', 'review');
    rerender(<HomeView state={{ ...first, syncing: true }} />);
    expect(container.firstElementChild).toHaveAttribute('data-home-priority', 'intro');
    expect(screen.getByRole('heading', { name: 'Reading your Gmail.' })).toBeInTheDocument();
  });
});
