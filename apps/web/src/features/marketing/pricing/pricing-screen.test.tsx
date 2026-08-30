import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TIER_MANIFEST } from '@declutrmail/shared/entitlements';
import { storeConsent } from '@/lib/cookie-consent';

import { formatUsd } from './pricing-model';
import { PricingScreen } from './pricing-screen';

/**
 * /pricing screen tests (D17 pricing leg, D19 ladder).
 *
 * Price expectations are computed FROM `TIER_MANIFEST` — the test is
 * itself the single-source proof: re-price the manifest and these
 * assertions follow.
 */

const h = vi.hoisted(() => ({
  push: vi.fn(),
  track: vi.fn().mockResolvedValue(undefined),
  joinWaitlist: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: h.push }),
}));

vi.mock('@/lib/posthog', () => ({
  track: h.track,
}));

vi.mock('@/lib/api/waitlist', () => ({
  joinWaitlist: h.joinWaitlist,
}));

beforeEach(() => {
  storeConsent('all');
  h.push.mockClear();
  h.track.mockClear();
  h.joinWaitlist.mockReset();
});

const monthly = (id: 'plus' | 'pro') => formatUsd(TIER_MANIFEST[id].prices.monthly!.usdCents);
const annual = (id: 'plus' | 'pro') => formatUsd(TIER_MANIFEST[id].prices.annual!.usdCents);
const promoPrice = formatUsd(TIER_MANIFEST.pro.promo!.annual.usdCents);

describe('PricingScreen (D19)', () => {
  it('renders all five manifest tiers with ANNUAL prices by default (locked 2026-08-02)', () => {
    render(<PricingScreen />);

    for (const id of ['free', 'plus', 'pro', 'team', 'enterprise'] as const) {
      expect(screen.getAllByText(TIER_MANIFEST[id].name).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(formatUsd(0))).toBeInTheDocument();
    expect(screen.getByText(annual('plus'))).toBeInTheDocument();
    // Pro's card carries the Founding Pro promo on annual, not the list
    // annual price — the promo is annual-only by construction.
    expect(
      screen.getAllByText(formatUsd(TIER_MANIFEST.pro.promo!.annual.usdCents)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('No card required')).toHaveLength(1);
    // Annual price lines carry a "/mo effective" note instead of the
    // monthly billing line, so that string is absent on the default view.
    expect(screen.queryAllByText('Billed monthly · cancel anytime')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Scrollable plan comparison' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('flips to annual prices (incl. the Founding Pro promo price) on toggle', () => {
    render(<PricingScreen />);

    fireEvent.click(screen.getByRole('button', { name: /Annual/ }));

    expect(screen.getByText(annual('plus'))).toBeInTheDocument();
    // Standard Pro annual still visible (struck through next to the promo)…
    expect(screen.getAllByText(annual('pro')).length).toBeGreaterThan(0);
    // …and the promo price takes the Pro card's price slot.
    expect(screen.getAllByText(promoPrice).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Monthly' }));
    expect(screen.getByText(monthly('pro'))).toBeInTheDocument();
  });

  it('shows the Founding Pro banner without implying a spot is still available', () => {
    render(<PricingScreen />);
    const promo = TIER_MANIFEST.pro.promo!;
    expect(
      screen.getByText(
        new RegExp(`${promo.name} — \\${promoPrice}/yr for the first ${promo.maxRedemptions}`),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Availability is confirmed at checkout/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check availability' })).toBeInTheDocument();
  });

  it('emits page_viewed on mount (D159)', () => {
    render(<PricingScreen />);
    expect(h.track).toHaveBeenCalledWith('page_viewed', { page: 'pricing', mailbox_id: null });
  });

  it('submits the Team waitlist, confirms on 202, and emits waitlist_joined', async () => {
    h.joinWaitlist.mockResolvedValue({ data: { status: 'accepted' } });
    render(<PricingScreen />);

    const input = screen.getByLabelText('Work email for the Team waitlist');
    fireEvent.change(input, { target: { value: 'founder@company.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByText(/You’re on the list/)).toBeInTheDocument());
    expect(h.joinWaitlist).toHaveBeenCalledWith({
      email: 'founder@company.com',
      tierInterest: 'team',
      source: 'pricing',
    });
    expect(h.track).toHaveBeenCalledWith('waitlist_joined', {
      tier_interest: 'team',
      source: 'pricing',
    });
  });

  it('a duplicate submit gets the SAME confirmed UX (server is oracle-free)', async () => {
    // The server returns the identical 202 body for duplicates — the
    // client renders the same confirmation, with no "already signed up"
    // branch anywhere in the tree.
    h.joinWaitlist.mockResolvedValue({ data: { status: 'accepted' } });
    render(<PricingScreen />);

    const input = screen.getByLabelText('Work email for the Team waitlist');
    fireEvent.change(input, { target: { value: 'already-on-list@company.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByText(/You’re on the list/)).toBeInTheDocument());
    // Scoped to the CLAIM, not the word. A bare /already/i matched any
    // prose on the page — the hero copy says "mail already in your
    // inbox" — so this asserted the absence of an English word rather
    // than the absence of a duplicate-signup branch.
    expect(screen.queryByText(/already (signed up|on the list|registered|joined)/i)).toBeNull();
  });

  it('shows the error state when the waitlist call fails, and recovers on edit', async () => {
    h.joinWaitlist.mockRejectedValue(new Error('network down'));
    render(<PricingScreen />);

    const input = screen.getByLabelText('Work email for the Team waitlist');
    fireEvent.change(input, { target: { value: 'founder@company.com' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(screen.getByText(/Couldn’t reach the server/)).toBeInTheDocument());
    expect(h.track).not.toHaveBeenCalledWith('waitlist_joined', expect.anything());

    // Editing the email clears the error.
    fireEvent.change(input, { target: { value: 'founder2@company.com' } });
    expect(screen.queryByText(/Couldn’t reach the server/)).not.toBeInTheDocument();
  });

  it('renders the Enterprise contact-sales mailto', () => {
    render(<PricingScreen />);
    const link = screen.getByRole('link', { name: 'Contact sales' });
    expect(link).toHaveAttribute('href', expect.stringMatching(/^mailto:/));
  });

  it('explains what happens when the Free monthly cap is reached', () => {
    render(<PricingScreen />);
    expect(screen.getByText(/until the next month or an upgrade/i)).toBeInTheDocument();
  });
});
