import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { storeConsent } from '@/lib/cookie-consent';
import type { Me } from './api/me-contract';

const apiPatch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiPatch }));

const me = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('./auth-provider', () => ({ useAuth: () => ({ me: me.current as Me }) }));

import { HeardFromPrompt } from './heard-from-prompt';

function meWithPrompt(promptNeeded: boolean) {
  return {
    user: { id: 'u1', email: 'owner@declutrmail.ai' },
    signupAttribution: { ref: 'hn', heardFrom: null, promptNeeded },
  } as unknown as Me;
}

function renderPrompt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HeardFromPrompt />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiPatch.mockReset();
  apiPatch.mockResolvedValue({});
  me.current = meWithPrompt(true);
  localStorage.clear();
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
});

afterEach(() => {
  localStorage.clear();
  document.cookie = 'dm_cookie_consent=; Max-Age=0; Path=/';
});

describe('HeardFromPrompt', () => {
  /**
   * The collision this pins is invisible on a desktop canvas.
   *
   * Both this card and the D147 consent banner are `position: fixed` at
   * `bottom: 16` with `width: calc(100vw - 32px); max-width: 400px`,
   * anchored to opposite sides — so below a 832px viewport they are the
   * SAME rectangle, and the banner's z-index 150 covers this card's 140.
   * Both mount on the onboarding layout and the app chrome, so a first
   * login on a phone showed the prompt to nobody. Consent asks first.
   */
  it('stays hidden until the consent banner has been answered', async () => {
    renderPrompt();
    expect(screen.queryByTestId('heard-from-prompt')).not.toBeInTheDocument();

    storeConsent('essential');

    expect(await screen.findByTestId('heard-from-prompt')).toBeInTheDocument();
  });

  it('does not ask a user who already answered', () => {
    storeConsent('all');
    me.current = meWithPrompt(false);
    renderPrompt();
    expect(screen.queryByTestId('heard-from-prompt')).not.toBeInTheDocument();
  });

  it('sends the chosen channel and retires itself', async () => {
    storeConsent('all');
    renderPrompt();
    await userEvent.click(await screen.findByRole('button', { name: 'Hacker News' }));

    expect(apiPatch).toHaveBeenCalledWith('/api/me/signup-heard-from', { heardFrom: 'hn' });
    await waitFor(() => expect(screen.queryByTestId('heard-from-prompt')).not.toBeInTheDocument());
  });

  it('says a failed save failed instead of silently resetting', async () => {
    storeConsent('all');
    apiPatch.mockRejectedValue(new Error('offline'));
    renderPrompt();
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }));

    expect(await screen.findByRole('status')).toHaveTextContent("That didn't save. Try again.");
    // Still mounted, still retryable — a dead-looking control was the bug.
    expect(screen.getByTestId('heard-from-prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled();
  });
});
