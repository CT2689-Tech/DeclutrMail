import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const captureSpy = vi.fn(async (..._args: unknown[]) => {});
vi.mock('@/lib/sentry', () => ({ initSentryBrowser: async () => {} }));
vi.mock('@/lib/error-capture', () => ({
  captureErrorBoundaryException: (...args: unknown[]) => captureSpy(...args),
}));

import { RouteErrorScreen } from './route-error-screen';

describe('RouteErrorScreen', () => {
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
        eyebrow="Settings hit a snag"
        headline="We couldn't load your settings."
        body="Nothing was changed."
        escape={{ href: '/senders', label: 'Back to Senders' }}
      />,
    );

    expect(screen.getByRole('heading', { name: /couldn't load your settings/i })).toBeVisible();
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
