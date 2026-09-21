import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell, ScreenIntro, useUiStore } from '@declutrmail/shared';

// HelpButton is a private module of the shell (single consumer), so it is
// exercised through AppShell's top bar rather than imported directly.
function Shell({ children }: { children?: ReactNode }) {
  return (
    <AppShell active="senders" onNavigate={vi.fn()}>
      {children}
    </AppShell>
  );
}

beforeEach(() => {
  useUiStore.setState({ screenHelp: null });
});

describe('ScreenIntro → top-bar help', () => {
  it('renders nothing on the screen and hides the button until a screen registers help', () => {
    const view = render(<Shell />);
    expect(screen.queryByRole('button', { name: 'About this screen' })).not.toBeInTheDocument();

    view.rerender(
      <Shell>
        <div data-testid="screen">
          <ScreenIntro id="senders" title="Senders" body="Everyone who emails you." />
        </div>
      </Shell>,
    );

    expect(screen.getByTestId('screen')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'About this screen' })).toBeInTheDocument();
  });

  it('opens a focus-managed popover with the registered content, and Escape restores focus', async () => {
    const user = userEvent.setup();
    render(
      <Shell>
        <ScreenIntro
          id="triage"
          title="Triage"
          body="Decide one sender at a time."
          tip="K keeps."
          learnMore={{ href: '/help#actions-in-gmail-terms', label: 'What each action does' }}
        />
      </Shell>,
    );

    const trigger = screen.getByRole('button', { name: 'About this screen' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'About Triage' });
    expect(within(dialog).getByText('Decide one sender at a time.')).toBeInTheDocument();
    expect(within(dialog).getByText('K keeps.')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /What each action does/ })).toHaveAttribute(
      'href',
      '/help#actions-in-gmail-terms',
    );
    expect(within(dialog).getByRole('button', { name: 'Close help' })).toHaveFocus();

    // Trapped: Tab from the last control wraps to the first.
    await user.tab();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close help' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('follows the screen: the next route replaces the help, leaving a screen clears it', () => {
    const view = render(
      <Shell>
        <ScreenIntro id="senders" title="Senders" body="Everyone who emails you." />
      </Shell>,
    );
    expect(useUiStore.getState().screenHelp?.id).toBe('senders');

    view.rerender(
      <Shell>
        <ScreenIntro id="triage" title="Triage" body="Decide one sender at a time." />
      </Shell>,
    );
    expect(useUiStore.getState().screenHelp?.id).toBe('triage');

    view.rerender(<Shell />);
    expect(useUiStore.getState().screenHelp).toBeNull();
    expect(screen.queryByRole('button', { name: 'About this screen' })).not.toBeInTheDocument();
  });
});
