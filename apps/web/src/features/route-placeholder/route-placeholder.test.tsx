/**
 * Tests for `RoutePlaceholder` — the shared "coming soon" surface
 * used by stub routes whose feature build is queued (Brief / Snoozed /
 * Screener / Quiet hours / Activity / Billing / Settings root).
 *
 * The tests pin the contract this component owes to every stub route:
 *
 *   - The eyebrow `status` chip renders (so the surface reads as
 *     intentional, not broken).
 *   - The `title` renders as a heading (a11y — every route landing
 *     surface must own a heading per D211 edge-state inventory).
 *   - The primary CTA is a real link (not a button) so Next.js can
 *     own client-side routing.
 *   - Internal plan references never render in product UI.
 *   - The forbidden empty-state words ("Nothing here", "0 results",
 *     "Error") are NOT in the rendered output — the component is the
 *     guard rail for those, not just the routes that consume it.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { RoutePlaceholder } from './route-placeholder';

const BASE_PROPS = {
  status: 'Planned for V2.1',
  title: 'Daily Brief',
  description: "A short summary of yesterday's mail, ready every morning at 8am local.",
  decisions: ['D61', 'D62', 'D63'],
  primaryCta: { href: '/triage', label: 'Open Triage' },
} as const;

describe('RoutePlaceholder', () => {
  it('renders the status chip, title, body, and primary CTA as a link', () => {
    render(<RoutePlaceholder {...BASE_PROPS} />);

    expect(screen.getByText('Planned for V2.1')).toBeInTheDocument();

    const heading = screen.getByRole('heading', { name: 'Daily Brief' });
    expect(heading).toBeInTheDocument();

    expect(screen.getByText(/A short summary of yesterday's mail/)).toBeInTheDocument();

    const cta = screen.getByRole('link', { name: 'Open Triage' });
    expect(cta).toHaveAttribute('href', '/triage');
  });

  it('does not render internal plan references', () => {
    render(<RoutePlaceholder {...BASE_PROPS} />);
    expect(screen.queryByText(/Plan refs:/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bD(?:61|62|63)\b/);
  });

  it('renders a secondary CTA when supplied', () => {
    render(
      <RoutePlaceholder
        {...BASE_PROPS}
        secondaryCta={{ href: '/senders', label: 'Open Senders' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open Triage' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Senders' })).toBeInTheDocument();
  });

  it('omits the secondary CTA when not supplied', () => {
    render(<RoutePlaceholder {...BASE_PROPS} />);
    expect(screen.queryByRole('link', { name: 'Open Senders' })).not.toBeInTheDocument();
  });

  // D209/D212 microcopy guard — these phrases would cast an unbuilt
  // route as broken. The component supplies the visual contract; we
  // pin that no consumer can leak forbidden phrasing through the
  // default rendering of the props above.
  it('does not render the forbidden empty-state phrases by default', () => {
    const { container } = render(<RoutePlaceholder {...BASE_PROPS} />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/Nothing here/i);
    expect(html).not.toMatch(/0 results/i);
    // "Error" can appear in legitimate copy ("Error code 500…"), so
    // we only forbid the bare-word usage as a heading-shaped string.
    expect(screen.queryByRole('heading', { name: /^Error$/ })).not.toBeInTheDocument();
  });
});
