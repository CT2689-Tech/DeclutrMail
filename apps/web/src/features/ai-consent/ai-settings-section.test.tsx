import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { AiSettingsSection } from './ai-settings-section';

const declinedBrief = {
  explanations: 'allowed' as const,
  brief: 'declined' as const,
  reask: false,
};

const copy = WS2_COPY.aiConsent;

describe('AiSettingsSection', () => {
  it('shows explanations On when Brief is declined, and revokes explanations only', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: { aiConsent: { ...declinedBrief, explanations: 'off' } },
            meta: {},
          });
        },
      },
    ]);
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <AiSettingsSection view={declinedBrief} briefCapable />
        </QueryWrapper>,
      );

      const explanations = screen.getByRole('switch', { name: copy.settings.label.all });
      expect(explanations).toHaveAttribute('aria-checked', 'true');
      expect(explanations).toHaveTextContent(copy.settings.state.on);
      expect(
        screen.queryByText(copy.upgrade.decline.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: copy.notNow })).not.toBeInTheDocument();
      expect(screen.queryByText(copy.settings.help.all)).not.toBeInTheDocument();
      expect(
        screen.queryByText(copy.settings.help.withBrief.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).not.toBeInTheDocument();

      const brief = screen.getByRole('switch', { name: BRIEF_NAME });
      expect(brief).toHaveAttribute('aria-checked', 'false');

      await userEvent.click(explanations);
      await waitFor(() => expect(bodies).toEqual([{ action: 'revoke', scope: 'explanations' }]));
    } finally {
      resetFetchStub();
    }
  });

  it('opens the Brief upgrade card only from the Brief control', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({ data: { aiConsent: declinedBrief }, meta: {} });
        },
      },
    ]);
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <AiSettingsSection view={declinedBrief} briefCapable />
        </QueryWrapper>,
      );
      await userEvent.click(screen.getByRole('switch', { name: BRIEF_NAME }));
      await userEvent.click(screen.getByRole('button', { name: copy.notNow }));
      await waitFor(() => expect(bodies).toEqual([{ action: 'not_now', card: 'upgrade' }]));
    } finally {
      resetFetchStub();
    }
  });
});
