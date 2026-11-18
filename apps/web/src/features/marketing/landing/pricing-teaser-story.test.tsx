import { captureException } from '@sentry/nextjs';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonOk } from '@/test/fetch-stub';

import { PricingTeaserGate } from './pricing-teaser-story';

vi.mock('@/lib/posthog', () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PricingTeaserGate', () => {
  it('shows the launch teaser with dollar prices when visitor-locale fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    render(<PricingTeaserGate />);

    expect(await screen.findByTestId('pricing-teaser-story')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.getByText('$59')).toBeInTheDocument();
    expect(screen.getByText('$19')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(screen.queryByText(legacyRefundNote())).not.toBeInTheDocument();
  });

  it('shows rupees on the teaser only after visitor-locale says inr', async () => {
    let releaseLocale: (value: Response) => void = () => undefined;
    const localeGate = new Promise<Response>((resolve) => {
      releaseLocale = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL) => localeGate),
    );

    render(<PricingTeaserGate />);

    expect(await screen.findByText('$59')).toBeInTheDocument();
    expect(screen.queryByText('₹1,999')).not.toBeInTheDocument();
    releaseLocale(jsonOk({ locale: 'inr' }));
    expect(await screen.findByText('₹1,999')).toBeInTheDocument();
    expect(screen.getByText('₹799')).toBeInTheDocument();
    expect(screen.queryByText('$59')).not.toBeInTheDocument();
  });

  it('keeps dollar prices when visitor-locale is not India', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonOk({ locale: 'usd' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<PricingTeaserGate />);

    expect(await screen.findByText('$59')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/visitor-locale'))).toBe(
        true,
      );
    });
    expect(screen.getByText('$59')).toBeInTheDocument();
    expect(screen.queryByText('₹1,999')).not.toBeInTheDocument();
  });

  it('never reads the retired public pricing flags', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(jsonOk({ locale: 'usd' })),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<PricingTeaserGate />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContainEqual(
      expect.stringContaining('/api/pricing/public'),
    );
  });
});

function legacyRefundNote(): string {
  return ['30', 'day money-back guarantee on every paid plan.'].join('-');
}
