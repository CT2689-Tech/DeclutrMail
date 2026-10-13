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

function stubFetch(impl: () => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PricingTeaserGate', () => {
  it('keeps today’s teaser when /api/pricing/public 404s', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = stubFetch(() => Promise.resolve(new Response('missing', { status: 404 })));

    render(<PricingTeaserGate />);

    expect(
      screen.getByRole('heading', { name: 'Start free. Pay when it earns it.' }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/pricing/public');
    expect(screen.queryByTestId('pricing-teaser-story')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps today’s teaser when the pricing request fails on the network', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    render(<PricingTeaserGate />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(
      screen.getByRole('heading', { name: 'Start free. Pay when it earns it.' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('pricing-teaser-story')).not.toBeInTheDocument();
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('shows the launch teaser only after a 200 with pricingV2', async () => {
    stubFetch(() => Promise.resolve(jsonOk({ data: { pricingV2: true, passEnabled: false } })));

    render(<PricingTeaserGate />);

    expect(await screen.findByTestId('pricing-teaser-story')).toBeInTheDocument();
  });

  it('shows rupees on the teaser only after visitor-locale says inr', async () => {
    let releaseLocale: (value: Response) => void = () => undefined;
    const localeGate = new Promise<Response>((resolve) => {
      releaseLocale = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/visitor-locale')) return localeGate;
        return Promise.resolve(jsonOk({ data: { pricingV2: true, passEnabled: true } }));
      }),
    );

    render(<PricingTeaserGate pricingV2 passEnabled />);

    expect(await screen.findByText('$59 a year')).toBeInTheDocument();
    expect(screen.queryByText('₹1,999 a year')).not.toBeInTheDocument();
    releaseLocale(jsonOk({ locale: 'inr' }));
    expect(await screen.findByText('₹1,999 a year')).toBeInTheDocument();
    expect(screen.getByText('₹799 once')).toBeInTheDocument();
    expect(screen.queryByText('$59 a year')).not.toBeInTheDocument();
  });

  it('keeps dollar prices when visitor-locale is not India', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/visitor-locale')) return Promise.resolve(jsonOk({ locale: 'usd' }));
      return Promise.resolve(jsonOk({ data: { pricingV2: true, passEnabled: false } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<PricingTeaserGate pricingV2 passEnabled={false} />);

    expect(await screen.findByText('$59 a year')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/visitor-locale'))).toBe(
        true,
      );
    });
    expect(screen.getByText('$59 a year')).toBeInTheDocument();
    expect(screen.queryByText('₹1,999 a year')).not.toBeInTheDocument();
  });

  it('keeps the launch teaser when the server flag is on and the public read 404s', async () => {
    const fetchMock = stubFetch(() => Promise.resolve(new Response('missing', { status: 404 })));

    render(<PricingTeaserGate pricingV2 passEnabled={false} />);

    expect(await screen.findByTestId('pricing-teaser-story')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('pricing-teaser-story')).toBeInTheDocument();
    expect(screen.queryByText(legacyRefundNote())).not.toBeInTheDocument();
  });
});

function legacyRefundNote(): string {
  return ['30', 'day money-back guarantee on every paid plan.'].join('-');
}
