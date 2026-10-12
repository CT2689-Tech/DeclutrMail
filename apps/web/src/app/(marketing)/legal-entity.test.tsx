/**
 * Founder decision 2026-10-11 12:26 PM PT: ship without a legal name or
 * business address. The line and the postal block stay off the page
 * until the constants are filled. Nothing may render the old placeholder,
 * an empty legal-entity element, or a broken "operated by" sentence.
 */

import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { hasPostalAddress } from '@declutrmail/shared/copy';
import { hasLegalEntity } from '@declutrmail/shared/copy/legal-entity';
import { storeConsent } from '@/lib/cookie-consent';
import { PublicFooter } from '@/features/marketing/public-shell/public-shell';

import ContactPage from './contact/page';
import CookiePreferencesPage from './cookies/page';
import HelpPage from './help/page';
import PrivacyPolicyPage from './privacy/page';
import RefundPolicyPage from './refunds/page';
import SecurityPage from './security/page';
import TermsOfServicePage from './terms/page';

/** Async routes resolve launch flags before render; sync pages stay components. */
async function pageElement(
  Page: React.ComponentType | (() => Promise<ReactElement>),
): Promise<ReactElement> {
  if (Page.constructor.name === 'AsyncFunction') return (Page as () => Promise<ReactElement>)();
  return createElement(Page as React.ComponentType);
}

vi.mock('@/lib/posthog', () => ({
  track: vi.fn().mockResolvedValue(undefined),
  withdrawAnalyticsConsent: vi.fn().mockResolvedValue(undefined),
}));

const PAGES = [
  ['footer', PublicFooter],
  ['/contact', ContactPage],
  ['/privacy', PrivacyPolicyPage],
  ['/terms', TermsOfServicePage],
  ['/refunds', RefundPolicyPage],
  ['/cookies', CookiePreferencesPage],
  ['/security', SecurityPage],
  ['/help', HelpPage],
] as const;

beforeEach(() => {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
  storeConsent('all');
});

afterEach(() => {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
});

function assertNoPlaceholder(container: HTMLElement) {
  const text = container.textContent ?? '';
  expect(text).not.toContain('FILL_ME');
  expect(text).not.toMatch(/operated by\s*,/i);
  expect(text).not.toMatch(/,\s*\./);

  const legal = container.querySelectorAll('[data-legal-entity]');
  if (!hasLegalEntity()) {
    expect(legal).toHaveLength(0);
  }
  for (const element of legal) {
    const line = (element.textContent ?? '').trim();
    expect(line).not.toBe('');
    expect(line).not.toContain('FILL_ME');
    expect(line).not.toMatch(/^·$/);
    expect(line).not.toMatch(/operated by\s*,/i);
  }

  if (!hasPostalAddress()) {
    expect(container.querySelector('#postal-address')).toBeNull();
  }
}

describe('legal entity omission', () => {
  it.each(PAGES)(
    '%s renders no placeholder and no empty legal-entity element',
    async (_name, Page) => {
      const { container } = render(await pageElement(Page));
      assertNoPlaceholder(container);
    },
  );
});
