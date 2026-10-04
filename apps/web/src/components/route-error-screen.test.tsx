import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const captureSpy = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/sentry', () => ({ initSentryBrowser: async () => {} }));
vi.mock('@/lib/error-capture', () => ({
  captureErrorBoundaryException: (...args: unknown[]) => captureSpy(...args),
}));

import { RouteErrorScreen } from './route-error-screen';
import LaterError from '@/app/(app)/later/error';
import SettingsError from '@/app/(app)/settings/error';
import PrivacyError from '@/app/(app)/settings/privacy/error';
import ProtectedError from '@/app/(app)/settings/senders/error';
import HelpError from '@/app/(app)/settings/help/error';
import TriageError from '@/app/(app)/triage/error';

describe('RouteErrorScreen', () => {
  it.each([
    { View: LaterError, title: 'Later', kicker: 'Catch up / Coming back to you', gap: 32 },
    { View: SettingsError, title: 'Settings', kicker: 'Your workspace / Preferences', gap: 32 },
    {
      View: PrivacyError,
      title: 'Privacy & data',
      kicker: 'Your workspace / Privacy & data',
      gap: 32,
    },
    {
      View: ProtectedError,
      title: 'Protected senders',
      kicker: 'Your workspace / Sender policies',
      gap: 12,
    },
    {
      View: HelpError,
      title: 'Help & glossary',
      kicker: 'Your workspace / A useful reference',
      gap: 24,
    },
  ])(
    'retains $title identity while offering recovery without error leaks',
    ({ View, title, kicker, gap }) => {
      const reset = vi.fn();
      render(<View error={new Error('private backend value')} reset={reset} />);
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByText(kicker)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: /couldn't load/i })).toBeInTheDocument();
      expect(screen.getByRole('region')).toHaveStyle({ maxWidth: '1120px', gap: `${gap}px` });
      expect(document.body).not.toHaveTextContent('private backend value');
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reset).toHaveBeenCalledTimes(1);
    },
  );
  it('uses saved Triage list geometry without changing the saved preference', () => {
    localStorage.setItem('dm.triage.mode', JSON.stringify('list'));
    try {
      render(<TriageError error={new Error('private')} reset={() => {}} />);
      expect(screen.getByRole('region')).toHaveStyle({ maxWidth: '928px' });
      expect(screen.getByRole('region')).toHaveAttribute('data-triage-mode', 'list');
      expect(screen.getByRole('region').className).toContain('triage');
      expect(localStorage.getItem('dm.triage.mode')).toBe('"list"');
    } finally {
      localStorage.removeItem('dm.triage.mode');
    }
  });
  it('keeps one main landmark inside the authenticated shell', () => {
    const { container } = render(
      <main>
        <LaterError error={new Error('private')} reset={() => {}} />
      </main>,
    );
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Later' })).toBeInTheDocument();
  });
  it('uses a main landmark for a standalone fallback', () => {
    render(
      <RouteErrorScreen
        error={new Error('private')}
        reset={() => {}}
        boundary="app-router-error"
        headline="Couldn’t load."
        body="Try again."
        escape={{ href: '/triage', label: 'Back to Triage' }}
      />,
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });
  it('renders copy + digest, never the error message (D7), and tags the boundary', async () => {
    const reset = vi.fn();
    const error = Object.assign(new Error('secret internals: token=abc'), {
      digest: 'DIGEST123',
    });

    render(
      <RouteErrorScreen
        error={error}
        reset={reset}
        boundary="settings"
        headline="We couldn't load your settings."
        body="Nothing was changed."
        escape={{ href: '/senders', label: 'Back to Senders' }}
      />,
    );

    expect(screen.getByRole('heading', { name: /couldn't load your settings/i })).toBeVisible();
    const disclosure = screen.getByText('Show support reference');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/DIGEST123/)).toBeVisible();
    // Privacy: raw error message must never reach the DOM.
    expect(document.body.textContent).not.toContain('secret internals');
    expect(screen.getByRole('link', { name: 'Back to Senders' })).toHaveAttribute(
      'href',
      '/senders',
    );

    screen.getByRole('button', { name: /try again/i }).click();
    expect(reset).toHaveBeenCalled();

    await waitFor(() =>
      expect(captureSpy).toHaveBeenCalledWith(error, {
        boundary: 'settings',
        digest: 'DIGEST123',
      }),
    );
  });
});
