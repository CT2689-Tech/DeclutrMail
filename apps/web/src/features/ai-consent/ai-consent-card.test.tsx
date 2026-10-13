import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { AiConsentCard as CardKind } from '@declutrmail/shared/ai-consent';
import { ToastHost } from '@declutrmail/shared';
import { WS2_COPY } from '@declutrmail/shared/copy/launch';
import { BRIEF_NAME } from '@declutrmail/shared/copy/screen-decisions';

import { installFetchStub, jsonOk, resetFetchStub } from '@/test/fetch-stub';
import { createTestQueryClient, QueryWrapper } from '@/test/query-wrapper';

import { AiConsentCard } from './ai-consent-card';

const view = { explanations: 'unset' as const, brief: 'unset' as const, reask: false };

function fillBrief(template: string): string {
  return template.replaceAll('{BRIEF_NAME}', BRIEF_NAME);
}

function valueAt(root: unknown, path: string): unknown {
  let cursor = root;
  for (const part of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object' || !(part in cursor)) {
      throw new Error(`missing NOT SHIPPING path ${path}`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const text = fillBrief(value).trim();
    if (text.length > 0) out.push(text);
    return;
  }
  if (value == null || typeof value !== 'object') return;
  for (const child of Object.values(value)) collectStrings(child, out);
}

/** Deck strings marked NOT SHIPPING. Empty means the marker cannot fail. */
function notShippingTexts(): string[] {
  const out: string[] = [];
  for (const path of WS2_COPY.aiConsent._notShipping) {
    collectStrings(valueAt(WS2_COPY.aiConsent, path), out);
  }
  for (const path of WS2_COPY.aiPrompt._notShipping) {
    collectStrings(valueAt(WS2_COPY.aiPrompt, path), out);
  }
  return out;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}

describe('AiConsentCard', () => {
  it('renders the short title, one body line, link, and actions, and none of the NOT SHIPPING keys', () => {
    const banned = notShippingTexts();
    expect(banned.length).toBeGreaterThan(0);
    expect(banned).toContain(WS2_COPY.aiConsent.noFetch);
    expect(banned).toContain(WS2_COPY.aiConsent.explain.sends);
    expect(banned).toContain(fillBrief(WS2_COPY.aiConsent.brief.sends));
    expect(banned).not.toContain(WS2_COPY.aiConsent.reask);
    expect(banned).toContain(fillBrief(WS2_COPY.aiConsent.settings.help.withBrief));
    expect(banned).toContain(fillBrief(WS2_COPY.aiConsent.revoked.toast.withBrief));
    expect(banned).toContain(fillBrief(WS2_COPY.aiConsent.upgrade.decline));
    expect(banned).toContain(WS2_COPY.aiPrompt.frequency);
    expect(WS2_COPY.aiConsent._notShipping).not.toContain('intro');
    expect(WS2_COPY.aiConsent._notShipping).not.toContain('upgrade.body');

    const titles: Record<CardKind, string> = {
      all: WS2_COPY.aiConsent.title.all,
      withBrief: fillBrief(WS2_COPY.aiConsent.title.withBrief),
      upgrade: fillBrief(WS2_COPY.aiConsent.upgrade.title),
    };
    const bodies: Record<CardKind, string> = {
      all: WS2_COPY.aiConsent.intro.all,
      withBrief: fillBrief(WS2_COPY.aiConsent.intro.withBrief),
      upgrade: fillBrief(WS2_COPY.aiConsent.upgrade.body),
    };

    for (const kind of ['all', 'withBrief', 'upgrade'] as const) {
      const { unmount } = render(
        <QueryWrapper client={createTestQueryClient()}>
          <AiConsentCard view={view} card={kind} />
        </QueryWrapper>,
      );
      const region = screen.getByRole('region', { name: titles[kind] });
      expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.allow })).toBeEnabled();
      expect(screen.getByRole('button', { name: WS2_COPY.aiConsent.notNow })).toBeEnabled();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
      expect(region.style.height).toBe('');
      const link = screen.getByRole('link', { name: WS2_COPY.aiConsent.link });
      expect(link).toHaveAttribute('href', '/privacy#ai-processing');
      expect(link).toHaveClass('dm-external-link', 'dm-tap-target');
      const text = region.textContent ?? '';
      const expected = [
        titles[kind],
        bodies[kind],
        WS2_COPY.aiConsent.link,
        WS2_COPY.aiConsent.allow,
        WS2_COPY.aiConsent.notNow,
      ].join('');
      expect(compact(text)).toBe(compact(expected));
      expect(text).not.toContain(WS2_COPY.aiConsent.reask);
      for (const phrase of banned) {
        if (expected.includes(phrase)) continue;
        expect(text).not.toContain(phrase);
      }
      unmount();
    }
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

  it('toasts the Brief-only allowed line from the upgrade card', async () => {
    installFetchStub([
      {
        method: 'POST',
        path: '/api/me/ai-consent',
        respond: () =>
          jsonOk({
            data: { aiConsent: { explanations: 'off', brief: 'allowed', reask: false } },
            meta: {},
          }),
      },
    ]);
    try {
      render(
        <QueryWrapper client={createTestQueryClient()}>
          <>
            <AiConsentCard view={view} card="upgrade" />
            <ToastHost />
          </>
        </QueryWrapper>,
      );
      await userEvent.click(screen.getByRole('button', { name: WS2_COPY.aiConsent.allow }));
      expect(
        await screen.findByText(fillBrief(WS2_COPY.aiConsent.brief.allowed)),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(fillBrief(WS2_COPY.aiConsent.allowed.toast.withBrief)),
      ).not.toBeInTheDocument();
    } finally {
      resetFetchStub();
    }
  });

  it('shows Updated when the stored version asks again', () => {
    render(
      <QueryWrapper client={createTestQueryClient()}>
        <AiConsentCard view={{ ...view, reask: true }} card="all" />
      </QueryWrapper>,
    );
    expect(screen.getByText(WS2_COPY.aiConsent.reask)).toBeInTheDocument();
  });
});
