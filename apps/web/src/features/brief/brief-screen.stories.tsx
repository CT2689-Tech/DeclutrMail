// Storybook CSF3 stories for the BriefScreen (D61, D63, D67, D69, D70, D210).
//
// The screen reads from `useBriefToday` (TanStack Query). We mount a
// QueryClient with prefilled cache state per story so each variant
// renders deterministically — same pattern the followups + senders
// stories use until the full Storybook seed lands.
//
// Mirrors the local-shim pattern from sibling story files so this
// typechecks before the PR-3 Storybook seed merges (D210). Swap the
// shims for `@storybook/react` imports once the seed merges; the
// story shapes do not change.

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { tokens } from '@declutrmail/shared';

import type { BriefWire } from '@/lib/api/brief';

import { briefKeys } from './api/query-keys';
import { BriefScreen } from './brief-screen';

type StoryMeta<C extends (...args: never) => unknown> = {
  title: string;
  component: C;
  parameters?: Record<string, unknown>;
  tags?: readonly string[];
};

type Story<C extends (props: never) => unknown> = {
  args?: Partial<Parameters<C>[0]>;
  parameters?: Record<string, unknown>;
  render?: (args: Parameters<C>[0]) => ReturnType<C>;
};

const BASE: BriefWire = {
  id: '11111111-1111-1111-1111-111111111111',
  runDateLocal: '2026-05-24',
  generatedBy: 'llm_haiku',
  briefPayload: {
    narrative:
      'Two emails need replies, one FYI worth scanning, and four newsletters you can archive.',
    reply: [
      {
        senderKey: 'sk-boss',
        senderName: 'Big Boss',
        senderEmail: 'boss@example.com',
        subject: 'Q4 plans — please review when you get a chance',
        isVip: true,
        messageIds: ['m-boss-1'],
      },
      {
        senderKey: 'sk-vendor',
        senderName: 'Vendor Finance',
        senderEmail: 'finance@vendor.io',
        subject: 'Invoice #4471 — net-30 question',
        isVip: false,
        messageIds: ['m-vendor-1'],
      },
    ],
    fyi: [
      {
        senderKey: 'sk-bank',
        senderName: 'First National',
        senderEmail: 'noreply@first.example',
        subject: 'May statement is ready',
        isVip: false,
        messageIds: ['m-bank-1'],
      },
    ],
    noise: [
      {
        senderKey: 'sk-news',
        senderName: 'Newsletter Daily',
        messageCount: 4,
        messageIds: ['m-news-1', 'm-news-2', 'm-news-3', 'm-news-4'],
      },
      {
        senderKey: 'sk-shop',
        senderName: 'Old Navy',
        messageCount: 3,
        messageIds: ['m-shop-1', 'm-shop-2', 'm-shop-3'],
      },
    ],
  },
  generatedAt: '2026-05-25T08:00:00Z',
  // openedAt set so the mark-opened POST does not auto-fire from the
  // story render — Storybook isn't mocking the fetch layer here.
  openedAt: '2026-05-25T08:30:00Z',
  emailSentAt: null,
};

function makeClient(brief: BriefWire | undefined): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } },
  });
  if (brief) {
    // The hook reads `select: env => env.data`; pre-stamp the
    // envelope shape so the screen receives a real BriefWire.
    client.setQueryData(briefKeys.today(), { data: brief });
  }
  return client;
}

function frame(client: QueryClient) {
  return (
    <div style={{ background: tokens.color.bg, minHeight: 480, padding: 12 }}>
      <QueryClientProvider client={client}>
        <BriefScreen />
      </QueryClientProvider>
    </div>
  );
}

const meta: StoryMeta<typeof BriefScreen> = {
  title: 'Features/Brief/BriefScreen',
  component: BriefScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Daily Brief screen (D61, D63, D67, D69, D70). 3 sections — Reply, FYI, Noise — rendered from the frozen 8am snapshot. VIP star (D67) on Reply rows; D70 quiet-inbox copy on empty days; "via template" provenance marker (D62) when Haiku fell back.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;

/** Populated — Reply (2) + FYI (1) + Noise (2 senders, 7 messages). */
export const Populated: Story<typeof BriefScreen> = {
  render: (_args: ComponentProps<typeof BriefScreen>) => frame(makeClient(BASE)),
};

/**
 * Mobile (≤sm, D60) — the Reply/FYI and Noise rows restack to
 * single-column cards: avatar + sender on row 1, subject/count and the
 * Gmail link stack full-width below so nothing overflows a phone.
 */
export const Mobile: Story<typeof BriefScreen> = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (_args: ComponentProps<typeof BriefScreen>) => frame(makeClient(BASE)),
};

/** D70 — quiet-inbox empty state when all sections are empty. */
export const QuietInbox: Story<typeof BriefScreen> = {
  render: (_args: ComponentProps<typeof BriefScreen>) =>
    frame(
      makeClient({
        ...BASE,
        briefPayload: { reply: [], fyi: [], noise: [], narrative: '' },
      }),
    ),
};

/** D62 — `via template` marker on the date line when the LLM fell back. */
export const TemplateFallback: Story<typeof BriefScreen> = {
  render: (_args: ComponentProps<typeof BriefScreen>) =>
    frame(
      makeClient({
        ...BASE,
        generatedBy: 'template',
        briefPayload: {
          ...BASE.briefPayload,
          narrative: '2 emails need replies, 1 FYI, 7 messages you can archive.',
        },
      }),
    ),
};

/** Reply-only — no FYI, no Noise. Verifies sections suppress cleanly. */
export const ReplyOnly: Story<typeof BriefScreen> = {
  render: (_args: ComponentProps<typeof BriefScreen>) =>
    frame(
      makeClient({
        ...BASE,
        briefPayload: {
          ...BASE.briefPayload,
          fyi: [],
          noise: [],
        },
      }),
    ),
};
