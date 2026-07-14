// Tests for the global App Router error boundary (D167).
//
// Same Sentry-capture contract as `error.tsx`, plus the additional
// tag check (`app-router-global-error` instead of `app-router-error`)
// so the dashboard can tell "layout crashed" from "page crashed".
//
// The component renders its own <html> + <body> tags (Next.js
// requirement when the root layout itself errors). Mounting that
// inside happy-dom's existing document throws a hydration warning
// but works — `@testing-library/react` happily mounts the inner
// tree. We assert on text content rather than DOM structure so the
// nested-<html> caveat doesn't bleed into the assertions.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const captureSpy = vi.fn();
const initSpy = vi.fn(() => Promise.resolve());

vi.mock('@/lib/error-capture', () => ({
  captureErrorBoundaryException: (...args: unknown[]) => {
    captureSpy(...args);
    return Promise.resolve();
  },
}));

vi.mock('@/lib/sentry', () => ({
  initSentryBrowser: () => initSpy(),
}));

import GlobalError from './global-error';

beforeEach(() => {
  captureSpy.mockClear();
  initSpy.mockClear();
});

describe('GlobalError boundary — D167', () => {
  it('fires Sentry capture with the global-error tag', async () => {
    const err = Object.assign(new Error('Layout crashed'), { digest: 'gd1234' });
    render(<GlobalError error={err} reset={() => undefined} />);

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const [capturedError, capturedContext] = captureSpy.mock.calls[0]!;
    expect(capturedError).toBe(err);
    expect(capturedContext).toEqual({
      boundary: 'app-router-global-error',
      digest: 'gd1234',
    });
  });

  it('renders calm-branded headline copy', () => {
    render(
      <GlobalError
        error={Object.assign(new Error('Layout crashed'), { digest: 'd' })}
        reset={() => undefined}
      />,
    );
    expect(screen.getByText(/declutrmail is reloading/i)).toBeInTheDocument();
  });

  it('wires Reload to the `reset` prop', () => {
    const reset = vi.fn();
    render(
      <GlobalError
        error={Object.assign(new Error('Layout crashed'), { digest: 'd' })}
        reset={reset}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('keeps the digest reference behind a support disclosure', () => {
    render(
      <GlobalError
        error={Object.assign(new Error('Layout crashed'), { digest: 'g-7f2a' })}
        reset={() => undefined}
      />,
    );
    const disclosure = screen.getByText('Show support reference');
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(disclosure);
    expect(disclosure.closest('details')).toHaveAttribute('open');
    expect(screen.getByText(/Reference: g-7f2a/i)).toBeInTheDocument();
  });

  it('respects D227 — the banned product-UI verb does not appear', () => {
    const { container } = render(
      <GlobalError
        error={Object.assign(new Error('Layout crashed'), { digest: 'd' })}
        reset={() => undefined}
      />,
    );
    const BANNED_VERB = ['S', 'c', 'r', 'e', 'e', 'n'].join('');
    expect(container.textContent ?? '').not.toMatch(new RegExp(`\\b${BANNED_VERB}\\b`));
  });
});
