import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ToastHost } from '@declutrmail/shared';
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
const briefLabel = copy.settings.brief.label.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
const briefHelp = copy.settings.brief.help.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
const retired = [
  copy.settings.label.withBrief,
  copy.settings.help.withBrief,
  copy.revoked.toast.withBrief,
].map((line) => line.replaceAll('{BRIEF_NAME}', BRIEF_NAME));

function expectHelpLinks(): void {
  const links = screen.getAllByRole('link', { name: copy.link });
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link).toHaveAttribute('href', '/privacy#ai-processing');
    expect(link).toHaveClass('dm-external-link');
  }
}

describe('AiSettingsSection', () => {
  it('titles the group from the deck', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <AiSettingsSection view={declinedBrief} briefCapable={false} />
      </QueryWrapper>,
    );

    expect(screen.getByRole('heading', { level: 2, name: copy.settings.title })).toHaveTextContent(
      copy.settings.title,
    );
    expect(screen.getByRole('region', { name: copy.settings.title })).toBeInTheDocument();
  });

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
      expect(screen.getByText(copy.settings.help.all)).toBeInTheDocument();
      expect(screen.getByText(briefLabel)).toBeInTheDocument();
      expect(screen.getByText(briefHelp)).toBeInTheDocument();
      expectHelpLinks();
      for (const line of retired) expect(screen.queryByText(line)).not.toBeInTheDocument();
      expect(
        screen.queryByText(copy.upgrade.decline.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: copy.notNow })).not.toBeInTheDocument();

      const brief = screen.getByRole('switch', { name: briefLabel });
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
      await userEvent.click(screen.getByRole('switch', { name: briefLabel }));
      await userEvent.click(screen.getByRole('button', { name: copy.notNow }));
      await waitFor(() => expect(bodies).toEqual([{ action: 'not_now', card: 'upgrade' }]));
    } finally {
      resetFetchStub();
    }
  });

  it('toasts the Brief-only revoked line when that switch turns off', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: () =>
          jsonOk({
            data: {
              aiConsent: { explanations: 'allowed', brief: 'off', reask: false },
            },
            meta: {},
          }),
      },
    ]);
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <>
            <AiSettingsSection
              view={{ explanations: 'allowed', brief: 'allowed', reask: false }}
              briefCapable
            />
            <ToastHost />
          </>
        </QueryWrapper>,
      );
      await userEvent.click(screen.getByRole('switch', { name: briefLabel }));
      expect(
        await screen.findByText(copy.brief.revoked.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(copy.revoked.toast.withBrief.replaceAll('{BRIEF_NAME}', BRIEF_NAME)),
      ).not.toBeInTheDocument();
    } finally {
      resetFetchStub();
    }
  });
});
