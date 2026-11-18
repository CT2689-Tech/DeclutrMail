import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/posthog', () => ({ track: vi.fn(() => Promise.resolve()) }));

import { PricingStory } from './pricing-story';

const NOW = '2026-10-27T07:01:00.000Z';
const NOTICE =
  'Buying a plan in rupees is paused for now, so these prices are for reference. If you already pay in rupees, you can still manage your plan in Billing. Email support@declutrmail.com for help.';

describe('INR pause copy on /pricing', () => {
  it('shows the notice and paused India answer to INR visitors while paused', () => {
    render(<PricingStory locale="inr" now={NOW} />);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    const answer = screen.getByText(/Buying in rupees is paused for now/);
    expect(answer).toHaveTextContent('Backlog Pass');
    expect(answer).toHaveTextContent('Plus');
    expect(screen.queryByText(/You can pay with UPI/)).not.toBeInTheDocument();
  });

  it('keeps the notice off the page for visitors outside India while paused', () => {
    render(<PricingStory locale="usd" now={NOW} />);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'What do you charge in India?' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Buying in rupees is paused for now/)).toBeInTheDocument();
  });

  it('uses the existing India answer and hides the notice when purchases are open', () => {
    render(<PricingStory locale="inr" now={NOW} rupeePurchasesOpen />);
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
    expect(screen.queryByText(/Buying in rupees is paused for now/)).not.toBeInTheDocument();
    expect(screen.getByText(/prices are in rupees and include GST/)).toBeInTheDocument();
    expect(screen.queryByText(/You can pay with UPI/)).not.toBeInTheDocument();
  });

  it('shows dollar prices and the pause notice for an India visitor while checkout is closed', () => {
    render(<PricingStory locale="usd" now={NOW} inrPaused />);
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    expect(screen.getByText(/Buying in rupees is paused for now/)).toBeInTheDocument();
    expect(screen.getByText('$59')).toBeInTheDocument();
    expect(screen.queryByText('₹1,999')).not.toBeInTheDocument();
  });
});
