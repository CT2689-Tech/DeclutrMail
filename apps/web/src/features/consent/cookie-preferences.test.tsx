import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hasAnalyticsConsent, readStoredConsent, storeConsent } from '@/lib/cookie-consent';
import { __resetForTests, track } from '@/lib/posthog';
import { CookiePreferences } from './cookie-preferences';

/**
 * D147 change/withdrawal surface (GDPR Art. 7(3)) — the contracts:
 * the card reflects the STORED choice (no choice renders as the
 * effective default, essential-only), upgrading stores "all" in both
 * stores, and downgrading withdraws — store flip + SDK identity reset —
 * with no Save step.
 */

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

function clearStoredConsent(): void {
  window.localStorage.removeItem('dm-cookie-consent');
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
}

beforeEach(() => {
  clearStoredConsent();
  __resetForTests();
  posthogMock.init.mockClear();
  posthogMock.reset.mockClear();
  vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const allRadio = () => screen.getByRole('radio', { name: /accept all/i });
const essentialRadio = () => screen.getByRole('radio', { name: /essential only/i });

describe('CookiePreferences (D147 withdrawal surface)', () => {
  it('renders essential-only selected when no choice is stored — the effective default', async () => {
    render(<CookiePreferences />);
    await waitFor(() => expect(essentialRadio()).toBeChecked());
    expect(allRadio()).not.toBeChecked();
    // Copy states the boundary plainly: essential always on, the choice
    // governs optional analytics only.
    const card = screen.getByTestId('cookie-preferences');
    expect(card).toHaveTextContent('Essential cookies for sign-in and billing are always on');
    expect(card).toHaveTextContent('This choice governs optional analytics only.');
  });

  it('renders the stored choice ("all")', async () => {
    storeConsent('all');
    render(<CookiePreferences />);
    await waitFor(() => expect(allRadio()).toBeChecked());
    expect(essentialRadio()).not.toBeChecked();
  });

  it('renders the stored choice ("essential")', async () => {
    storeConsent('essential');
    render(<CookiePreferences />);
    await waitFor(() => expect(essentialRadio()).toBeChecked());
  });

  it('upgrade essential→all writes BOTH stores and grants analytics consent', async () => {
    storeConsent('essential');
    render(<CookiePreferences />);
    await waitFor(() => expect(essentialRadio()).toBeChecked());

    fireEvent.click(allRadio());

    expect(window.localStorage.getItem('dm-cookie-consent')).toBe('all');
    expect(document.cookie).toContain('dm_cookie_consent=all');
    expect(hasAnalyticsConsent()).toBe(true);
    expect(allRadio()).toBeChecked();
  });

  it('downgrade all→essential withdraws: both stores flip and the SDK identity resets', async () => {
    storeConsent('all');
    // Consent alone intentionally does not download analytics. Exercise
    // one explicit event so there is a loaded identity-bearing SDK to reset.
    await track('page_viewed', { page: 'settings', mailbox_id: null });
    render(<CookiePreferences />);
    await waitFor(() => expect(allRadio()).toBeChecked());

    fireEvent.click(essentialRadio());

    await waitFor(() => {
      expect(window.localStorage.getItem('dm-cookie-consent')).toBe('essential');
    });
    expect(document.cookie).toContain('dm_cookie_consent=essential');
    expect(hasAnalyticsConsent()).toBe(false);
    // Consent was "all" and a key is present, so the SDK handle existed
    // — withdrawal must drop its stored identity.
    await waitFor(() => expect(posthogMock.reset).toHaveBeenCalledTimes(1));
    expect(essentialRadio()).toBeChecked();
  });

  it('clicking the default "Essential only" with no stored choice stores an explicit decline', async () => {
    render(<CookiePreferences />);
    await waitFor(() => expect(essentialRadio()).toBeChecked());
    expect(readStoredConsent()).toBeNull();

    fireEvent.click(essentialRadio());

    await waitFor(() => expect(readStoredConsent()).toBe('essential'));
    // Nothing was ever granted — no SDK, no reset.
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });

  it('reflects a choice made on another surface in the same tab (banner → card sync)', async () => {
    render(<CookiePreferences />);
    await waitFor(() => expect(essentialRadio()).toBeChecked());

    // The banner (floating over the same page) grants consent.
    act(() => storeConsent('all'));

    expect(allRadio()).toBeChecked();
    expect(essentialRadio()).not.toBeChecked();
  });

  it('re-selecting the stored choice is a no-op (no extra writes, no reset)', async () => {
    storeConsent('all');
    render(<CookiePreferences />);
    await waitFor(() => expect(allRadio()).toBeChecked());

    fireEvent.click(allRadio());

    expect(readStoredConsent()).toBe('all');
    expect(posthogMock.reset).not.toHaveBeenCalled();
  });
});
