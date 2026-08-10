// Storybook CSF3 stories for onboarding step 5 under the
// `protect_important` goal — the D245 protection review.
//
// Real `Meta` / `StoryObj` types from the installed framework package —
// the local `Partial<…>` shim this file shipped with erased
// required-prop checking (a story omitting `row` compiled and crashed
// at render), and the Storybook runtime has been on disk since the
// #483 seed. Sibling stories still on shims convert as they're
// touched (§1.3).
//
// This screen FETCHES rather than taking a `state` prop, so — unlike
// `ScreenerScreen` — it cannot be driven by args. Each story seeds the
// real query cache under the real key and lets the real hook read it.
// Stubbing the hook would have made these stories claim states the
// component never actually produces, which is precisely the defect
// class this screen exists to avoid.
//
// The variants are the states that were WRONG before they were caught:
//
//   • 460 / 55  — the founder's mailbox: the reassurance leads
//   •   0 / 2   — the second connected account, where "we protected 0
//                 senders you write back to" would read as failure
//   •   N / 0   — nothing weak to review; the reassurance IS the win
//   •   0 / 0   — nothing protected at all, said plainly
//   • 460 / 55 with NO rows — the trap: `pinned === 0` meant both
//                 "nothing to review" and "plenty to review, none
//                 showable", and the first was rendered for the second
//   • counts absent — the server never computed them, so nothing is
//                 claimed

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type { OnboardingFirstTriageMeta } from '@declutrmail/shared/contracts';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
import { TRIAGE_STATS_KEY } from '@/features/triage/api/use-triage-queue';
import { FIRST_TRIAGE_KEY } from './api/use-onboarding';
import { StepProtectionReview } from './step-protection-review';

const { color } = tokens;

const meta: Meta<typeof StepProtectionReview> = {
  title: 'Onboarding/StepProtectionReview',
  component: StepProtectionReview,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Step 5 for the protect_important goal. The goal used to protect nothing — the verb registry is K/A/U/L/D with no Protect — while automatic protection had already shielded 515 senders before the step ran. This shows what was done and lets the user correct it.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof StepProtectionReview>;

/** Two weakly-protected rows, ranked by the mail they shield. */
const ROWS: TriageDecisionRow[] = [
  {
    ...TRIAGE_QUEUE[0]!,
    id: 'god-of-prompt',
    senderName: 'Robert from God of Prompt',
    protectionReason: 'starred',
    verdict: 'keep',
    unreadInboxCount: 145,
  },
  {
    ...TRIAGE_QUEUE[1]!,
    id: 'getyourguide',
    senderName: 'GetYourGuide',
    protectionReason: 'starred',
    verdict: 'keep',
    unreadInboxCount: 33,
  },
];

/**
 * Seed the REAL cache keys, then disable fetching so nothing races the
 * seed. `useFirstTriage` and `useTriageStats` read straight through.
 */
function Seeded({
  rows,
  meta: readMeta,
  children,
}: {
  rows: TriageDecisionRow[];
  meta: OnboardingFirstTriageMeta;
  children: React.ReactNode;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(FIRST_TRIAGE_KEY, { rows, meta: readMeta });
  client.setQueryData(TRIAGE_STATS_KEY, {
    decidedToday: 0,
    archivedToday: 0,
    unsubscribedToday: 0,
    laterToday: 0,
    freeRemaining: null,
    tier: 'free',
  });
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: 640 }}>{children}</div>
    </QueryClientProvider>
  );
}

function story(rows: TriageDecisionRow[], readMeta: OnboardingFirstTriageMeta) {
  return (
    <Seeded rows={rows} meta={readMeta}>
      <StepProtectionReview onComplete={() => {}} completing={false} />
    </Seeded>
  );
}

/**
 * The founder's mailbox: 460 protected by a reply, 55 by a single
 * one-way signal. The reassurance leads; the rows are the ones worth a
 * look, costliest first.
 */
export const ReassuranceLeads: Story = {
  render: () =>
    story(ROWS, { pinned: 2, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } }),
};

/**
 * The second connected account — 0 strong / 2 weak. A "we protected 0"
 * headline would be true and useless, so the headline states the fact
 * that exists instead. Zero strong is not an empty review.
 */
export const NoRepliesProtected: Story = {
  render: () =>
    story(ROWS, { pinned: 2, decided: 0, protection: { strong: 0, weak: 2, manual: 0 } }),
};

/** Nothing weak to review — the reassurance IS the win. */
export const NothingToReview: Story = {
  render: () =>
    story([], { pinned: 0, decided: 0, protection: { strong: 12, weak: 0, manual: 0 } }),
};

/**
 * Nothing protected at all. Says WHY protection is absent, so an empty
 * result does not read as a broken scan.
 */
export const NothingProtectedYet: Story = {
  render: () => story([], { pinned: 0, decided: 0, protection: { strong: 0, weak: 0, manual: 0 } }),
};

/**
 * The caught trap: 55 weak protections and not one showable (every
 * candidate decided inside the queue's recent-decision window, or not
 * yet scored). This rendered "Nothing else is protected on a weaker
 * signal" before the end panel learned to branch on the weak count.
 */
export const PlentyToReviewButNoneShowable: Story = {
  render: () =>
    story([], { pinned: 0, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } }),
};

/** Every pinned row resolved — acted on or unprotected. */
export const Reviewed: Story = {
  render: () =>
    story([], { pinned: 5, decided: 5, protection: { strong: 460, weak: 50, manual: 0 } }),
};

/**
 * The server took the cleanup branch, so no counts exist. Rows still
 * render; the headline claims nothing it cannot support.
 */
export const CountsNotComputed: Story = {
  render: () => story(ROWS, { pinned: 2, decided: 0 }),
};

/**
 * Every protection is the user's own Protect (#485). The panel names
 * them — the earlier branch read `strong: 0, weak: 0` as "Nothing is
 * protected yet … nothing is being held back from cleanup", which was
 * false precisely for the user who engaged with protection most
 * deliberately.
 */
export const OnlyManualProtections: Story = {
  render: () => story([], { pinned: 0, decided: 0, protection: { strong: 0, weak: 0, manual: 7 } }),
};

/** The read still in flight — nothing claimed while nothing is known. */
export const Loading: Story = {
  render: () => (
    <Pending>
      <StepProtectionReview onComplete={() => {}} completing={false} />
    </Pending>
  ),
};

/** The read failed — an error, visibly NOT "nothing is protected". */
export const LoadFailed: Story = {
  render: () => (
    <Failing error={new Error('boom')}>
      <StepProtectionReview onComplete={() => {}} completing={false} />
    </Failing>
  ),
};

/**
 * The read 409'd (`NO_ACTIVE_MAILBOX`) — a designed state, never a
 * retry (CLAUDE.md §8). The exit refreshes connection state instead of
 * re-asking a question that can only 409 again.
 */
export const MailboxConnectionChanged: Story = {
  render: () => (
    <Failing error={{ code: 'NO_ACTIVE_MAILBOX' }}>
      <StepProtectionReview onComplete={() => {}} completing={false} />
    </Failing>
  ),
};

/**
 * Sibling pattern (`snoozed-screen.stories.tsx`): a prefetch pins the
 * query's state and the mounted hook DEDUPES onto it — its own inline
 * `queryFn` never runs. `setQueryDefaults` cannot do this: the hook
 * passes its own `queryFn`, so per-key defaults are ignored.
 */
function pinnedClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        gcTime: Infinity,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** A client whose first-triage read never settles. */
function Pending({ children }: { children: React.ReactNode }) {
  const client = pinnedClient();
  void client.prefetchQuery({
    queryKey: FIRST_TRIAGE_KEY,
    queryFn: () => new Promise<never>(() => {}),
  });
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: 640 }}>{children}</div>
    </QueryClientProvider>
  );
}

/** A client whose first-triage read rejected with the given error. */
function Failing({ error, children }: { error: unknown; children: React.ReactNode }) {
  const client = pinnedClient();
  void client
    .prefetchQuery({
      queryKey: FIRST_TRIAGE_KEY,
      queryFn: () => Promise.reject(error),
    })
    .catch(() => {});
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: 640 }}>{children}</div>
    </QueryClientProvider>
  );
}
