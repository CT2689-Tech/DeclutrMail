import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { AiConsentCard } from './ai-consent-card';

const view = { explanations: 'unset' as const, brief: 'unset' as const, reask: false };

describe('AiConsentCard', () => {
  it('offers Allow and Not now, with no checkbox and a privacy link', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <AiConsentCard view={view} card="all" />
      </QueryWrapper>,
    );

    expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.allow })).toBeEnabled();
    expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow })).toBeEnabled();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: WS2_COPY.aiConsent.link })).toHaveAttribute(
      'href',
      '/privacy#ai-processing',
    );
    expect(screen.getByText(WS2_COPY.aiConsent.noFetch)).toBeInTheDocument();
  });

  it('posts Not now and does not treat it as Allow', async () => {
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
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <AiConsentCard view={view} card="all" />
        </QueryWrapper>,
      );
      await userEvent.click(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow }));
      await waitFor(() => expect(bodies).toEqual([{ action: 'not_now', card: 'all' }]));
    } finally {
      resetFetchStub();
    }
  });
});
