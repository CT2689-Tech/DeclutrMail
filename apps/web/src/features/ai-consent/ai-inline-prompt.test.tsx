import { act, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({
    me: { tier: 'free', mailboxes: [], inboxLimit: 1, pricingV2: false },
  }),
}));

import { AiInlineConsentInset, AiInlinePrompt } from './ai-inline-prompt';

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

    expect(screen.getByText(WS2_COPY.aiPrompt.text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WS2_COPY.aiPrompt.review })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WS2_COPY.aiPrompt.dismissAria })).toBeInTheDocument();
    expect(screen.queryByText(WS2_COPY.aiPrompt.frequency)).not.toBeInTheDocument();
  });

  it('keeps the opened consent card at the column width', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(ME_SETTINGS_QUERY_KEY, {
      aiConsent: { explanations: 'review', brief: 'unset', reask: true },
    });

    render(
      <QueryClientProvider client={client}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );

    expect(screen.getByTestId('ai-inline-consent')).toContainElement(
      screen.getByRole('button', { name: WS2_COPY.aiConsent.allow }),
    );
    expect(renderToStaticMarkup(<AiInlineConsentInset>card</AiInlineConsentInset>)).not.toContain(
      'padding',
    );
  });

  it('does not paint the suggestion into server HTML', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(ME_SETTINGS_QUERY_KEY, {
      aiConsent: { explanations: 'unset', brief: 'unset', reask: false },
    });
    localStorage.clear();
    const html = renderToString(
      <QueryClientProvider client={client}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    expect(html).not.toContain(WS2_COPY.aiPrompt.text);
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
            <AiInlinePrompt />
          </QueryClientProvider>,
          { onRecoverableError: (error) => errors.push(error) },
        );
      });
      expect(errors).toEqual([]);
      expect(container.textContent).toContain(WS2_COPY.aiPrompt.text);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
