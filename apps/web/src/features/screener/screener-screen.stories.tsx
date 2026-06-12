// Storybook CSF3 stories for the Screener screen (D71–D77, D226).
//
// Same lightweight CSF shims as `triage-screen.stories.tsx` so this
// typechecks before the Storybook seed; swap for real imports when it
// lands — story shapes do not change.
//
// Variants (D210 + D211/D212 contract):
//   • Default        — populated queue (3 first-time senders)
//   • Empty          — D76 calm single-line state
//   • Loading        — skeleton stack
//   • Error          — query failure + explicit retry
//   • RowExpanded    — D73 accordion body with the K/A/U/L/D toolbar
//   • PreviewPending — the mandatory D226 preview (Archive, real count)
//   • DeletePreview  — the red-toned Delete preview (30-day recovery)
//   • ProUpsell      — the D77 under-tier surface (D194-approved copy)

import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';

import { SCREENER_QUEUE } from './data';
import { ScreenerProUpsell } from './pro-upsell';
import { ScreenerRow } from './screener-row';
import { ScreenerScreen } from './screener-screen';

const { color } = tokens;

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
  play?: () => void | Promise<void>;
};

const meta: StoryMeta<typeof ScreenerScreen> = {
  title: 'Screener/ScreenerScreen',
  component: ScreenerScreen,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Screener — the soft-quarantine review queue for first-time senders (D72: DB flag only; Gmail untouched until the user decides). Rows are the D73 accordion; decisions are the canonical K/A/U/L/D verbs (D227 — the verb "Screen" never appears in copy); every destructive decision shows the D226 preview before mutation. Pro-only per D77.',
      },
    },
  },
  tags: ['autodocs'],
};
export default meta;

const noop = () => {};

/** Stories mount TanStack hooks — wrap in a quiet client. */
function Shell({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.paper, minHeight: '100vh' }}>{children}</div>
    </QueryClientProvider>
  );
}

export const Default: Story<typeof ScreenerScreen> = {
  render: () => (
    <Shell>
      <ScreenerScreen state={{ kind: 'ready', rows: [...SCREENER_QUEUE] }} />
    </Shell>
  ),
};

export const Empty: Story<typeof ScreenerScreen> = {
  render: () => (
    <Shell>
      <ScreenerScreen state={{ kind: 'empty' }} />
    </Shell>
  ),
  parameters: {
    docs: { description: { story: 'D76 — calm single-line message. No illustration, no CTA.' } },
  },
};

export const Loading: Story<typeof ScreenerScreen> = {
  render: () => (
    <Shell>
      <ScreenerScreen state={{ kind: 'loading' }} />
    </Shell>
  ),
};

export const ErrorState: Story<typeof ScreenerScreen> = {
  render: () => (
    <Shell>
      <ScreenerScreen state={{ kind: 'error', error: new Error('boom'), retry: noop }} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Query failure (D211) — explicit retry only; reads never auto-retry 4xx.',
      },
    },
  },
};

type RowProps = ComponentProps<typeof ScreenerRow>;

const rowBase: RowProps = {
  row: SCREENER_QUEUE[0]!,
  expanded: true,
  onToggleExpand: noop,
  onVerbClick: noop,
  onConfirm: noop,
  onCancel: noop,
};

export const RowExpanded: Story<typeof ScreenerRow> = {
  render: () => (
    <Shell>
      <div style={{ maxWidth: 900, margin: '24px auto' }}>
        <ScreenerRow {...rowBase} />
      </div>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'D73 accordion body — K/A/U/L/D toolbar, first-seen, message count, engine reasoning, "Open sender →" link.',
      },
    },
  },
};

export const PreviewPending: Story<typeof ScreenerRow> = {
  render: () => (
    <Shell>
      <div style={{ maxWidth: 900, margin: '24px auto' }}>
        <ScreenerRow {...rowBase} pendingVerb="archive" previewInboxCount={4} />
      </div>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'The mandatory D226 preview — REAL inbox count from GET /api/actions/preview, Confirm/Cancel before anything changes.',
      },
    },
  },
};

export const DeletePreview: Story<typeof ScreenerRow> = {
  render: () => (
    <Shell>
      <div style={{ maxWidth: 900, margin: '24px auto' }}>
        <ScreenerRow {...rowBase} pendingVerb="delete" previewInboxCount={2} />
      </div>
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story: 'Delete preview — red tone + the Gmail Trash 30-day recovery-window copy.',
      },
    },
  },
};

export const ProUpsell: Story<typeof ScreenerProUpsell> = {
  render: () => (
    <Shell>
      <ScreenerProUpsell onSeePricing={noop} />
    </Shell>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'D77 under-tier state — Free/Plus see the upgrade surface. Copy honours D194: collected for review, nothing moves until you decide.',
      },
    },
  },
};
