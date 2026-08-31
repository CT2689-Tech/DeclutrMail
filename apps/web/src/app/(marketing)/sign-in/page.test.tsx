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
  });

  it.each([
    ['missing', {}],
    ['unknown', { auth_result: 'unexpected' }],
    ['non-scalar', { auth_result: ['inbox_limit'] }],
  ])('renders no recovery alert for a %s result', async (_label, params) => {
    await renderPage(params);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
