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

describe('AiSettingsSection', () => {
  it('keeps the Brief upgrade card after Not now, so declining Brief does not clear explanations', async () => {
    const bodies: unknown[] = [];
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: async (req) => {
          bodies.push(await req.json());
          return jsonOk({
            data: { aiConsent: declinedBrief },
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
      expect(
        screen.getByText(WS2_COPY.aiConsent.upgrade.decline.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow }));
      await waitFor(() => expect(bodies).toEqual([{ action: 'not_now', card: 'upgrade' }]));
    } finally {
      resetFetchStub();
    }
  });
});
