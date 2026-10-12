import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { planName } from '@declutrmail/shared/entitlements';
import { WS1_COPY, WS2_COPY, WS5_COPY } from '@declutrmail/shared/copy/launch';

import { failedScanSettingsStep } from '@/features/mailboxes/mailbox-health';
import { STAGE_SENTENCE } from '@/features/onboarding/sync-stage-copy';
import { ApiError } from '@/lib/api/client';
import { loadErrorDescription } from '@/lib/load-error-copy';

import { HOME_DECK } from './home-deck-copy';
import { HomeView } from './home-view';

const action = { label: 'Review senders', href: '/senders' };

const ready = {
  kind: 'ready' as const,
  hero: { label: 'emails cleared', value: 1234 },
  since: '2026-03-15T12:00:00.000Z',
  secondary: [
    { label: 'Emails archived', value: 1200 },
    { label: 'Emails deleted', value: 34 },
    { label: 'Senders decided', value: 41 },
  ],
  action,
};

const steps = [
  { kind: 'unsub_archive' as const, senderCount: 158, emailCount: 1200, senderIds: ['s1'] },
  { kind: 'largest' as const, senderCount: 10, sizeLabel: '2.1 GB', senderIds: ['s2'] },
  { kind: 'later_due' as const, senderCount: 3, senderIds: ['s3'] },
];

/**
 * Chrome that predates the launch decks. New Home sentences are not
 * allowed to join this list — they have to come from a deck module.
 */
const ALLOWED = new Set<string>([
  'Loading Home',
  "We couldn't load Home",
  'Review senders',
  'Open Settings',
  'Try again',
  'Later',
  failedScanSettingsStep(true),
  loadErrorDescription(new ApiError(500, null, 'boom')),
  loadErrorDescription(new Error('offline')),
  planName('free'),
  planName('plus'),
  planName('pro'),
]);

function deckPhrases(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) deckPhrases(item, out);
  else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deckPhrases(item, out);
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fromDeck(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => {
    if (phrase === text) return true;
    if (phrase.includes('{')) {
      const pattern = phrase
        .split(/\{\w+\}/)
        .map(escapeRegExp)
        .join('.+');
      return new RegExp(`^${pattern}$`).test(text);
    }
    return phrase.includes(text);
  });
}

function textNodes(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: string[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (text) nodes.push(text);
    current = walker.nextNode();
  }
  return nodes;
}

function unexplained(root: HTMLElement, phrases: readonly string[]): string[] {
  return textNodes(root).filter((text) => {
    if (ALLOWED.has(text)) return false;
    if (/^[\d,]+$/.test(text)) return false;
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/.test(text)) return false;
    if (/^[·→!]$/.test(text)) return false;
    if (text === 'since') return false;
    return !fromDeck(text, phrases);
  });
}

describe('rendered Home text', () => {
  it('comes from the launch decks, not a hardcoded sentence in the view', () => {
    const phrases: string[] = [];
    deckPhrases(WS1_COPY, phrases);
    deckPhrases(WS2_COPY, phrases);
    deckPhrases(WS5_COPY, phrases);
    deckPhrases(STAGE_SENTENCE, phrases);

    const views = [
      <HomeView key="ready" state={ready} nextSteps={steps} senderSizeView timeZone="UTC" />,
      <HomeView key="flag" state={ready} nextSteps={steps} timeZone="UTC" tier="plus" />,
      <HomeView key="empty" state={{ kind: 'empty', syncing: false, action }} />,
      <HomeView key="syncing" state={{ kind: 'empty', syncing: true, action }} />,
      <HomeView
        key="stage"
        state={{
          kind: 'empty',
          syncing: true,
          action,
          stageSentence: HOME_DECK.syncingStage.fetching_metadata,
        }}
      />,
      <HomeView key="queued" state={{ kind: 'empty', syncing: true, queued: true, action }} />,
      <HomeView key="failed" state={{ kind: 'sync-failed', needsReconnect: false }} />,
      <HomeView key="reconnect" state={{ kind: 'sync-failed', needsReconnect: true }} />,
      <HomeView key="loading" state={{ kind: 'loading' }} />,
      <HomeView
        key="error"
        state={{ kind: 'error', error: new ApiError(500, null, 'boom'), retry: () => undefined }}
      />,
    ];

    const offenders = views.flatMap((view) => {
      const { unmount, container } = render(view);
      const mode = container.firstElementChild?.getAttribute('data-home-mode') ?? 'unknown';
      const found = unexplained(container, phrases).map((text) => `${mode}: ${text}`);
      unmount();
      return found;
    });

    expect(offenders).toEqual([]);
  });
});
