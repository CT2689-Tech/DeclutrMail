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
});
