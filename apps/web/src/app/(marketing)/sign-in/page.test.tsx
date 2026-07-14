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
    expect(alert).toHaveTextContent(/this Gmail can’t reconnect yet/i);
    expect(alert).toHaveTextContent(/sign in with another Gmail that is still connected/i);
    expect(alert).toHaveTextContent(/free an inbox slot or review your plan options/i);
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
