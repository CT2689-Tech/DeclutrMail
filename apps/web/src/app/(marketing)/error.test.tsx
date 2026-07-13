import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MarketingLayout from './layout';

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

import MarketingError from './error';

beforeEach(() => {
  captureSpy.mockClear();
  initSpy.mockClear();
});

const PRIVATE_MESSAGE = 'sender-secret@example.test failed while opening Triage';

function renderBoundary(reset = vi.fn()) {
  const error = Object.assign(new Error(PRIVATE_MESSAGE), { digest: 'private-digest-123' });

  return {
    error,
    reset,
    ...render(<MarketingError error={error} reset={reset} />),
  };
}

describe('(marketing) error boundary', () => {
  it('announces calm recovery copy without exposing raw error details', () => {
    const { container } = renderBoundary();

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1 })).toHaveTextContent(
      'This page didn’t finish loading.',
    );
    expect(container).not.toHaveTextContent(PRIVATE_MESSAGE);
    expect(container).not.toHaveTextContent('private-digest-123');
  });

  it('retries through the reset callback', () => {
    const reset = vi.fn();
    renderBoundary(reset);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('offers only public recovery destinations', () => {
    renderBoundary();

    const actions = screen.getByRole('group', { name: 'Page recovery options' });
    const expectedLinks = [
      ['Home', '/'],
      ['Demo', '/inbox-simulator'],
      ['Pricing', '/pricing'],
      ['Contact', '/contact'],
    ] as const;

    for (const [label, href] of expectedLinks) {
      expect(within(actions).getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    expect(within(actions).queryByRole('link', { name: /triage|senders|sign in/i })).toBeNull();
  });

  it('captures the exception while keeping the public shell and its single main landmark', async () => {
    const error = Object.assign(new Error(PRIVATE_MESSAGE), { digest: 'capture-digest' });

    const { container } = render(
      <MarketingLayout>
        <MarketingError error={error} reset={() => undefined} />
      </MarketingLayout>,
    );

    expect(screen.getByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(container.querySelectorAll('main')).toHaveLength(1);

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).toHaveBeenCalledWith(error, {
      boundary: 'app-router-error',
      digest: 'capture-digest',
    });
  });
});
