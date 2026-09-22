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

    const triage = within(sidebar()).getByRole('button', { name: 'Triage' });
    fireEvent.mouseEnter(triage);
    fireEvent.focus(triage);
    fireEvent.touchStart(triage);

    expect(onNavigateIntent.mock.calls).toEqual([['triage'], ['triage'], ['triage']]);
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent.mouseEnter(within(sidebar()).getByRole('button', { name: 'Senders' }));
    expect(onNavigateIntent).toHaveBeenCalledTimes(3);
  });
});

describe('AppShell — collapsible icon rail', () => {
  it('starts as an icon rail, expands labels, and remembers the choice on this device', () => {
    const first = render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    expect(within(sidebar()).queryByText('Triage')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(within(sidebar()).getByText('Triage')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    // Labels leave the DOM; each row keeps its name and gains a tooltip.
    expect(within(sidebar()).queryByText('Triage')).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('button', { name: 'Triage' })).toHaveAttribute(
      'title',
      'Triage',
    );
    expect(window.localStorage.getItem('dm.sidebar.collapsed')).toBe('true');

    first.unmount();
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('never collapses the mobile drawer, and gives it no collapse toggle', () => {
    window.localStorage.setItem('dm.sidebar.collapsed', 'true');
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(within(drawer).getByText('Triage')).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /sidebar$/ })).not.toBeInTheDocument();
  });
});

describe('AppShell — mobile tab bar', () => {
  it('navigates from a tab and marks the active one', () => {
    const onNavigate = vi.fn();
    render(
      <AppShell active="senders" onNavigate={onNavigate}>
        <div>Page content</div>
      </AppShell>,
    );

    expect(within(tabBar()).getByRole('button', { name: 'Senders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(within(tabBar()).getByRole('button', { name: 'Home' }));
    expect(onNavigate).toHaveBeenCalledWith('home');
  });

  it('opens the full navigation drawer from More', () => {
    render(
      <AppShell active="senders" onNavigate={vi.fn()}>
        <div>Page content</div>
      </AppShell>,
    );

    fireEvent.click(within(tabBar()).getByRole('button', { name: 'More' }));
    const drawer = screen.getByRole('dialog', { name: 'Navigation menu' });
    expect(within(drawer).getByRole('button', { name: 'Autopilot' })).toBeInTheDocument();
  });
});

describe('AppShell — route fade', () => {
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
