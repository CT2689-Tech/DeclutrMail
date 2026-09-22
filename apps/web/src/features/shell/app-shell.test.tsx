import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '@declutrmail/shared';

// jsdom applies no stylesheet, so the desktop sidebar AND the CSS-hidden
// mobile tab bar are both "visible" here — scope nav queries to one.
const sidebar = () => screen.getByRole('navigation', { name: 'Product navigation' });
const tabBar = () => screen.getByRole('navigation', { name: 'Primary' });

beforeEach(() => {
  window.localStorage.clear();
});

describe('AppShell interactions', () => {
  it('traps focus, closes on Escape, restores focus, and keeps 44px controls', () => {
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    const opener = screen.getByRole('button', { name: 'Open navigation menu' });
    expect(opener).toHaveStyle({ width: '44px', height: '44px' });
    fireEvent.click(opener);

    const close = screen.getByRole('button', { name: 'Close navigation menu' });
    expect(screen.getByRole('dialog', { name: 'Navigation menu' })).toBeInTheDocument();
    expect(close).toHaveFocus();
    expect(close).toHaveStyle({ width: '44px', height: '44px' });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('has no trust strip — those facts live in Settings and the action previews', () => {
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    expect(screen.queryByRole('button', { name: 'Undo windows' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stored Gmail data' })).not.toBeInTheDocument();
  });

  it('signals navigation intent from pointer, keyboard, and touch without firing the click', () => {
    const onNavigate = vi.fn();
    const onNavigateIntent = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate} onNavigateIntent={onNavigateIntent}>
        <div>Page content</div>
      </AppShell>,
    );

    const triage = within(screen.getByRole('navigation', { name: 'Clean up views' })).getByRole(
      'button',
      { name: 'Triage' },
    );
    fireEvent.mouseEnter(triage);
    fireEvent.focus(triage);
    fireEvent.touchStart(triage);

    expect(onNavigateIntent.mock.calls).toEqual([['triage'], ['triage'], ['triage']]);
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.mouseEnter(within(sidebar()).getByRole('button', { name: 'Clean up' }));
    expect(onNavigateIntent).toHaveBeenCalledTimes(3);
  });
});

describe('AppShell — fixed workspace rail', () => {
  it('ignores old expansion preference and always renders five icon groups', () => {
    window.localStorage.setItem('dm.sidebar.collapsed', 'false');
    render(
      <AppShell active="quiet" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );
    expect(within(sidebar()).getAllByRole('button')).toHaveLength(5);
    expect(within(sidebar()).getByRole('button', { name: 'Automations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('button', { name: /Expand sidebar|Collapse sidebar/ })).toBeNull();
    expect(window.localStorage.getItem('dm.sidebar.collapsed')).toBe('false');
  });
  it('routes brand and workspace settings controls', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'DeclutrMail overview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Workspace settings' }));
    expect(onNavigate.mock.calls).toEqual([['home'], ['settings']]);
  });
  it('keeps all ten features in the hamburger drawer and closes after navigation', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    for (const label of [
      'Home',
      'Senders',
      'Triage',
      'Screener',
      'Autopilot',
      'Quiet',
      'Brief',
      'Follow-ups',
      'Later',
      'Activity',
    ]) {
      expect(within(drawer).getByRole('button', { name: label })).toBeInTheDocument();
    }
    fireEvent.click(within(drawer).getByRole('button', { name: 'Later' }));
    expect(onNavigate).toHaveBeenCalledWith('snoozed');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('prefetches inactive group entry points on rail intent and mobile touch', () => {
    const onNavigate = vi.fn();
    const onNavigateIntent = vi.fn();
    render(
      <AppShell active="quiet" onNavigate={onNavigate} onNavigateIntent={onNavigateIntent}>
        <div>Page content</div>
      </AppShell>,
    );
    const cleanup = within(sidebar()).getByRole('button', { name: 'Clean up' });
    fireEvent.mouseEnter(cleanup);
    fireEvent.focus(cleanup);
    fireEvent.touchStart(cleanup);
    fireEvent.touchStart(within(tabBar()).getByRole('button', { name: 'Catch up' }));
    fireEvent.mouseEnter(within(sidebar()).getByRole('button', { name: 'Automations' }));
    fireEvent.touchStart(within(tabBar()).getByRole('button', { name: 'Automations' }));
    expect(onNavigateIntent.mock.calls).toEqual([['senders'], ['senders'], ['senders'], ['brief']]);
    expect(onNavigate).not.toHaveBeenCalled();
  });
  it('exposes child count/gate context and routes child clicks', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell
        active="senders"
        onNavigate={onNavigate}
        counts={{ screener: { text: 3, label: '3 new senders' } }}
        locks={{ screener: 'Pro' }}
      >
        <div>Page content</div>
      </AppShell>,
    );
    const child = within(screen.getByRole('navigation', { name: 'Clean up views' })).getByRole(
      'button',
      { name: /Screener/ },
    );
    expect(within(child).getByLabelText('3 new senders')).toBeInTheDocument();
    expect(within(child).getByLabelText('Pro feature')).toBeInTheDocument();
    fireEvent.click(child);
    expect(onNavigate).toHaveBeenCalledWith('screener');
  });
});

describe('AppShell — mobile workspace navigation', () => {
  it.each([
    ['triage', 'Clean up'],
    ['quiet', 'Automations'],
    ['followups', 'Catch up'],
    ['snoozed', 'Catch up'],
    ['home', 'Overview'],
    ['activity', 'Activity'],
  ])('marks the group for %s', (active, label) => {
    const onNavigate = vi.fn();
    render(
      <AppShell active={active} onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );
    expect(within(tabBar()).getAllByRole('button')).toHaveLength(5);
    expect(within(tabBar()).getByRole('button', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(tabBar()).queryByRole('button', { name: 'More' })).toBeNull();
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Overview' }));
    expect(onNavigate).toHaveBeenCalledWith('home');
  });
});

describe('AppShell — route fade', () => {
  it('starts a new screen at the top while preserving scroll within the same route', () => {
    const content = (routeKey: string, text: string) => (
      <AppShell active="senders" routeKey={routeKey} onNavigate={vi.fn()}>
        <div>{text}</div>
      </AppShell>
    );
    const view = render(content('/home', 'Home'));
    const scroller = view.container.querySelector<HTMLElement>('.dm-main-scroll')!;
    scroller.scrollTop = 180;
    fireEvent.scroll(scroller);
    view.rerender(content('/senders', 'Senders'));
    expect(scroller.scrollTop).toBe(0);

    scroller.scrollTop = 240;
    view.rerender(content('/senders', 'Another sender selected'));
    expect(scroller.scrollTop).toBe(240);
  });

  it('does not fade the first load, then restarts the fade on every route change', () => {
    const view = render(
      <AppShell active="senders" routeKey="/senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );
    const scroller = () => view.container.querySelector('.dm-main-scroll');
    expect(scroller()).not.toHaveAttribute('data-route-flip');

    const go = (routeKey: string) =>
      view.rerender(
        <AppShell active="senders" routeKey={routeKey} onNavigate={vi.fn()}>
          <div>Page content</div>
        </AppShell>,
      );

    go('/senders/abc');
    expect(scroller()).toHaveAttribute('data-route-flip', 'a');
    // A different animation-name is what restarts a CSS animation
    // without remounting the page.
    go('/triage');
    expect(scroller()).toHaveAttribute('data-route-flip', 'b');
    go('/triage');
    expect(scroller()).toHaveAttribute('data-route-flip', 'b');
  });
});
