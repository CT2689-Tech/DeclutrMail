// Tests for the App Router error boundary (D167).
//
// The boundary's two responsibilities:
//
//   1. **Auto-fire Sentry capture** on mount with the right tags +
//      digest. The test stubs `@/lib/error-capture` so we can assert
//      on the call shape without hitting the real Sentry SDK.
//
//   2. **Render calm-branded copy + a working `reset` button** that
//      delegates to the `reset` prop Next.js passes in.
//
// Why we mock at the `error-capture` module boundary instead of
// `@sentry/nextjs`: the boundary calls our wrapper, the wrapper calls
// Sentry. Mocking the wrapper keeps the test honest about what the
// boundary itself does (it does NOT call Sentry directly) and avoids
// the dynamic-import dance that the real wrapper performs.

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

// Import AFTER mocks are registered so the boundary picks them up.
import AppError from './error';

beforeEach(() => {
  captureSpy.mockClear();
  initSpy.mockClear();
});

describe('AppError boundary — D167', () => {
  it('fires Sentry capture on mount with the boundary tag + digest', async () => {
    const err = Object.assign(new Error('Boom'), { digest: 'abcdef1234567890' });
    render(<AppError error={err} reset={() => undefined} />);

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const [capturedError, capturedContext] = captureSpy.mock.calls[0]!;
    expect(capturedError).toBe(err);
    expect(capturedContext).toEqual({
      boundary: 'app-router-error',
      digest: 'abcdef1234567890',
    });
  });

  it('initialises Sentry before capturing (idempotent in real init)', async () => {
    render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: 'x' })}
        reset={() => undefined}
      />,
    );
    await waitFor(() => expect(initSpy).toHaveBeenCalled());
    await waitFor(() => expect(captureSpy).toHaveBeenCalled());
  });

  it('surfaces the error digest as a "Reference" code so support can grep Sentry', () => {
    render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: '7f2a9100' })}
        reset={() => undefined}
      />,
    );
    expect(screen.getByText(/Reference: 7f2a9100/i)).toBeInTheDocument();
  });

  it('hides the Reference row when the error has no digest', () => {
    render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: undefined })}
        reset={() => undefined}
      />,
    );
    expect(screen.queryByText(/Reference:/i)).toBeNull();
  });

  it('wires the "Try again" button to the `reset` prop', () => {
    const reset = vi.fn();
    render(<AppError error={Object.assign(new Error('Boom'), { digest: 'd' })} reset={reset} />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers a "Back to Triage" escape route', () => {
    render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: 'd' })}
        reset={() => undefined}
      />,
    );
    const link = screen.getByRole('link', { name: /back to triage/i });
    expect(link).toHaveAttribute('href', '/triage');
  });

  it('does not leak the raw error message into the rendered HTML', () => {
    // The message can contain user data. Only the digest is safe.
    const { container } = render(
      <AppError
        error={Object.assign(new Error('user@example.com tried to do X'), {
          digest: 'safe',
        })}
        reset={() => undefined}
      />,
    );
    expect(container.textContent).not.toContain('user@example.com');
  });

  it('uses calm, non-apologetic copy (D209) — no forbidden framings', () => {
    render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: 'd' })}
        reset={() => undefined}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1 }).textContent ?? '';
    // "Something went wrong" / "Error" / "Oops" are the canonical
    // forbidden framings the empty-state and error pages must avoid.
    expect(heading).not.toMatch(/something went wrong/i);
    expect(heading).not.toMatch(/^(error|oops|sorry)/i);
  });

  it('respects D227 — the banned product-UI verb does not appear', () => {
    const { container } = render(
      <AppError
        error={Object.assign(new Error('Boom'), { digest: 'd' })}
        reset={() => undefined}
      />,
    );
    const BANNED_VERB = ['S', 'c', 'r', 'e', 'e', 'n'].join('');
    expect(container.textContent ?? '').not.toMatch(new RegExp(`\\b${BANNED_VERB}\\b`));
  });
});
