import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { track } = vi.hoisted(() => ({ track: vi.fn(async () => undefined) }));
vi.mock('@/lib/posthog', () => ({ track }));

import SignInPage from './page';

async function renderPage(params: Record<string, string | string[] | undefined> = {}) {
  return render(await SignInPage({ searchParams: Promise.resolve(params) }));
}

describe('/sign-in OAuth recovery', () => {
  it('explains the closed inbox-limit recovery without requiring a session', async () => {
    await renderPage({ auth_result: 'inbox_limit' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/this Gmail can.t reconnect yet/i);
    expect(alert).toHaveTextContent(/every Gmail connection your plan allows is already in use/i);
    expect(alert).toHaveTextContent(/sign in with any connected Gmail to disconnect it/i);
    expect(alert).toHaveTextContent(/upgrade to connect more/i);
    expect(screen.getByRole('link', { name: /compare plans/i })).toHaveAttribute(
      'href',
      '/pricing',
    );
    // Server-rendered alerts are not announced on load; the retry button
    // carries the reason for anyone who tabs straight to it.
    expect(screen.getByRole('link', { name: /Continue with Google/i })).toHaveAccessibleDescription(
      /every Gmail connection your plan allows is already in use/i,
    );
  });

  it('says why Google sent the user back when Gmail was not granted', async () => {
    await renderPage({ auth_result: 'gmail_access_missing' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/needs Gmail access/i);
    expect(alert).toHaveTextContent(/Continue with Google and allow it/i);
    // The retry is the page's own Google button — one click back to consent.
    const retry = screen.getByRole('link', { name: /Continue with Google/i });
    expect(retry).toHaveAttribute('href', '/api/auth/google/start');
    expect(retry).toHaveAccessibleDescription(/needs Gmail access/i);
  });

  it('keeps the billing choice on the retry', async () => {
    await renderPage({
      auth_result: 'gmail_access_missing',
      returnTo: '/billing?plan=pro&cycle=annual',
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/needs Gmail access/i);
    expect(screen.getByRole('link', { name: /Continue with Google/i })).toHaveAttribute(
      'href',
      '/api/auth/google/start?returnTo=%2Fbilling%3Fplan%3Dpro%26cycle%3Dannual',
    );
  });

  // A sign-in that did not complete lands here instead of on API JSON.
  it.each([
    ['failed', /Google sign-in didn.t finish\. Try again\./],
    ['rate_limited', /Too many sign-in attempts\. Wait a minute, then try again\./],
  ])('says what happened for a %s sign-in', async (authResult, line) => {
    await renderPage({ auth_result: authResult });

    expect(screen.getByRole('alert')).toHaveTextContent(line);
    expect(screen.getByRole('link', { name: /Continue with Google/i })).toHaveAccessibleDescription(
      line,
    );
  });

  it.each([
    ['missing', {}],
    ['unknown', { auth_result: 'unexpected' }],
    ['non-scalar', { auth_result: ['inbox_limit'] }],
    ['non-scalar Gmail', { auth_result: ['gmail_access_missing'] }],
    ['non-scalar failed', { auth_result: ['failed'] }],
  ])('renders no recovery alert for a %s result', async (_label, params) => {
    await renderPage(params);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Continue with Google/i })).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});
