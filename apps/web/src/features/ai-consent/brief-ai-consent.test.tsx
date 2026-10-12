import { act, render, screen, waitFor } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { AI_PROMPT_INTERVAL_DAYS, BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';

import { BRIEF_UPGRADE_KEY, briefUpgradeDue } from './ai-prompt-queue';
import { BriefAiConsent } from './brief-ai-consent';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({ me: { tier: 'pro' } }),
}));

const declined = { explanations: 'allowed' as const, brief: 'declined' as const, reask: false };
const upgradeTitle = WS2_COPY.aiConsent.upgrade.title.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
const DAY_MS = 24 * 60 * 60 * 1000;

function renderBrief() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_SETTINGS_QUERY_KEY, { aiConsent: declined });
  return render(
    <QueryClientProvider client={client}>
      <BriefAiConsent />
    </QueryClientProvider>,
  );
}

it('shows an undecided Brief card only after hydration', async () => {
  const title = WS2_COPY.aiConsent.title.withBrief.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
  const server = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToString(
    <QueryClientProvider client={server}>
      <BriefAiConsent />
    </QueryClientProvider>,
  );
  expect(html).not.toContain(title);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_SETTINGS_QUERY_KEY, {
    aiConsent: { explanations: 'unset', brief: 'unset', reask: false },
  });
  const errors: unknown[] = [];
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(
        container,
        <QueryClientProvider client={client}>
          <BriefAiConsent />
        </QueryClientProvider>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });
    expect(errors).toEqual([]);
    expect(container.textContent).toContain(title);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    server.clear();
    client.clear();
  }
});

describe('BriefAiConsent after a Brief decline', () => {
  it('hides the upgrade card until a recorded re-ask is due', async () => {
    localStorage.clear();
    renderBrief();
    expect(screen.queryByRole('heading', { name: upgradeTitle })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('basic version');

    localStorage.setItem(
      BRIEF_UPGRADE_KEY,
      JSON.stringify({ count: 1, lastAt: Date.now() - (AI_PROMPT_INTERVAL_DAYS + 1) * DAY_MS }),
    );
    renderBrief();
    expect(await screen.findByRole('heading', { name: upgradeTitle })).toBeInTheDocument();
  });

  it('stays hidden after the re-ask has been dismissed twice', async () => {
    localStorage.setItem(
      BRIEF_UPGRADE_KEY,
      JSON.stringify({ count: 2, lastAt: Date.now() - (AI_PROMPT_INTERVAL_DAYS + 1) * DAY_MS }),
    );
    renderBrief();
    await waitFor(() => expect(briefUpgradeDue(Date.now())).toBe(false));
    expect(screen.queryByRole('heading', { name: upgradeTitle })).not.toBeInTheDocument();
  });
});
