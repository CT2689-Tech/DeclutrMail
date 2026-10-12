/**
 * With PRICING_V2 on, current refund copy uses POLICY.refundWindowDays.
 * Undo, Trash, and pause windows are a different 30 days and stay.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { priceFaqAnswer, refundSentence } from '@declutrmail/shared/copy/launch';
import { POLICY, refundLine } from '@declutrmail/shared/entitlements';

import { moneyBackNote } from '@/features/billing/billing-model';
import { renderLlmsTxt } from '@/features/marketing/llms/llms-document';
import { FaqPage } from '@/features/marketing/learn/index-pages';
import { installFetchStub } from '@/test/fetch-stub';

import HelpPage from './help/page';
import LandingPage from './page';
import { GET as pricingMarkdown } from './pricing.md/route';
import RefundPolicyPage from './refunds/page';

vi.mock('@/lib/posthog', () => ({ track: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));

function legacyRefundPattern(): RegExp {
  return new RegExp(`${30}[- ]day money[- ]back`, 'i');
}

function assertLaunchWindow(text: string): void {
  expect(text).not.toMatch(legacyRefundPattern());
  expect(text).toContain(`${POLICY.refundWindowDays}-day`);
}

describe('refund window with PRICING_V2 on', () => {
  beforeEach(() => {
    vi.stubEnv('PRICING_V2', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps 14 days on every current refund surface', async () => {
    const days = POLICY.refundWindowDays;
    expect(refundLine()).toBe(`${days}-day money-back on any purchase, once per customer.`);
    expect(moneyBackNote(true)).toBe(refundLine());
    expect(refundSentence()).toBe(refundLine());
    assertLaunchWindow(priceFaqAnswer());
    assertLaunchWindow(renderLlmsTxt());

    const markdown = await (await pricingMarkdown()).text();
    assertLaunchWindow(markdown);

    const help = render(<HelpPage />);
    const helpText = help.container.textContent ?? '';
    expect(helpText).not.toMatch(legacyRefundPattern());
    expect(helpText).toContain(`within ${days} days`);
    help.unmount();

    const faq = render(<FaqPage />);
    const faqText = faq.container.textContent ?? '';
    expect(faqText).not.toMatch(legacyRefundPattern());
    expect(faqText).toContain(`within ${days} days`);
    faq.unmount();

    const refunds = render(<RefundPolicyPage />);
    assertLaunchWindow(refunds.container.textContent ?? '');
    expect(refunds.container.textContent).toContain(`within ${days} days`);
    refunds.unmount();

    installFetchStub([
      {
        method: 'GET',
        path: '/api/auth/me',
        respond: () => new Response(JSON.stringify({ error: 'unauthenticated' }), { status: 401 }),
      },
      {
        method: 'GET',
        path: '/api/pricing/public',
        respond: () => new Response('missing', { status: 404 }),
      },
    ]);
    const landing = render(await LandingPage());
    expect(await screen.findByTestId('pricing-teaser-story')).toBeInTheDocument();
    await waitFor(() => {
      expect(landing.container.textContent).toContain(refundLine());
    });
    assertLaunchWindow(landing.container.textContent ?? '');
  });
});
