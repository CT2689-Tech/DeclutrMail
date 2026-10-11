import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';

vi.mock('next/navigation', () => ({ usePathname: () => '/triage' }));
vi.mock('@/features/auth/auth-provider', () => ({
  useAuth: () => ({
    me: { tier: 'free', mailboxes: [], inboxLimit: 1, pricingV2: false },
  }),
}));

import { AiInlinePrompt } from './ai-inline-prompt';

describe('AiInlinePrompt', () => {
  it('names the dismiss control with the deck label', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(ME_SETTINGS_QUERY_KEY, {
      aiConsent: { explanations: 'unset', brief: 'unset', reask: false },
    });
    localStorage.clear();

    render(
      <QueryClientProvider client={client}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('button', { name: WS2_COPY.aiPrompt.dismissAria })).toBeInTheDocument();
  });
});
