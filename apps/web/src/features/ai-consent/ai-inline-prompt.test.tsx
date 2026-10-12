import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { hydrateRoot } from 'react-dom/client';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { ME_SETTINGS_QUERY_KEY } from '@/features/settings/api/query-options';
import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';

const auth = vi.hoisted(() => ({ tier: 'free' }));

vi.mock('@/features/auth/auth-provider', () => ({
  useOptionalAuth: () => ({
    me: { tier: auth.tier, mailboxes: [], inboxLimit: 1, pricingV2: false },
  }),
}));

import { AI_PROMPT_KEY } from './ai-prompt-queue';
import { AiInlineConsentInset, AiInlinePrompt } from './ai-inline-prompt';

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

function unsetClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(ME_SETTINGS_QUERY_KEY, {
    aiConsent: { explanations: 'unset', brief: 'unset', reask: false },
  });
  return client;
}

afterEach(() => {
  auth.tier = 'free';
  localStorage.clear();
  resetFetchStub();
});

describe('AiInlinePrompt', () => {
  it('shows the short consent card and retires the inline question', async () => {
    localStorage.clear();
    render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('region', { name: WS2_COPY.aiConsent.title.all }),
    ).toBeInTheDocument();
    expect(screen.getByText(WS2_COPY.aiConsent.intro.all)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: WS2_COPY.aiConsent.link })).toHaveAttribute(
      'href',
      '/privacy#ai-processing',
    );
    expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.allow })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow })).toBeInTheDocument();
    expect(screen.queryByText(WS2_COPY.aiPrompt.text)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: WS2_COPY.aiPrompt.review }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: WS2_COPY.aiPrompt.dismiss }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(WS2_COPY.aiPrompt.frequency)).not.toBeInTheDocument();
  });

  it('uses the Brief title on a plan that includes the Daily Brief', async () => {
    auth.tier = 'pro';
    localStorage.clear();
    render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('region', { name: fillBrief(WS2_COPY.aiConsent.title.withBrief) }),
    ).toBeInTheDocument();
    expect(screen.getByText(fillBrief(WS2_COPY.aiConsent.intro.withBrief))).toBeInTheDocument();
  });

  it('treats Not now as a dismissal and does not store a decline', async () => {
    localStorage.clear();
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: { aiConsent: { explanations: 'off', brief: 'unset', reask: false } },
            meta: {},
          });
        },
      },
    ]);
    const user = userEvent.setup();
    const { unmount } = render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: WS2_COPY.aiConsent.notNow }));
    expect(screen.queryByRole('region', { name: WS2_COPY.aiConsent.title.all })).toBeNull();
    expect(JSON.parse(localStorage.getItem(AI_PROMPT_KEY) ?? '{}')).toMatchObject({ count: 1 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(bodies).toEqual([]);

    unmount();
    render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('region', { name: WS2_COPY.aiConsent.title.all })).toBeNull();
  });

  it('still stores Not now when the card is a re-ask', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: { aiConsent: { explanations: 'off', brief: 'unset', reask: false } },
            meta: {},
          });
        },
      },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(ME_SETTINGS_QUERY_KEY, {
      aiConsent: { explanations: 'review', brief: 'unset', reask: true },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow }));
    await waitFor(() => expect(bodies).toEqual([{ action: 'not_now', card: 'all' }]));
    expect(localStorage.getItem(AI_PROMPT_KEY)).toBeNull();
  });

  it('stores Allow on the short card', async () => {
    localStorage.clear();
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: { aiConsent: { explanations: 'allowed', brief: 'unset', reask: false } },
            meta: {},
          });
        },
      },
    ]);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: WS2_COPY.aiConsent.allow }));
    await waitFor(() => expect(bodies).toEqual([{ action: 'allow', card: 'all' }]));
  });

  it('stays hidden after two dismissals', async () => {
    localStorage.setItem(AI_PROMPT_KEY, JSON.stringify({ count: 2, lastAt: Date.now() }));
    render(
      <QueryClientProvider client={unsetClient()}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('region', { name: WS2_COPY.aiConsent.title.all })).toBeNull();
    expect(screen.queryByText(WS2_COPY.aiPrompt.text)).not.toBeInTheDocument();
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

  it('does not paint the nudge into server HTML', async () => {
    localStorage.clear();
    const client = unsetClient();
    const html = renderToString(
      <QueryClientProvider client={client}>
        <AiInlinePrompt />
      </QueryClientProvider>,
    );
    expect(html).not.toContain(WS2_COPY.aiPrompt.text);
    expect(html).not.toContain(WS2_COPY.aiConsent.title.all);
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
      expect(container.textContent).toContain(WS2_COPY.aiConsent.title.all);
      expect(container.textContent).not.toContain(WS2_COPY.aiPrompt.text);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });
});
