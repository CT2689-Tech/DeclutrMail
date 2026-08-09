// Storybook CSF3 stories for onboarding step 5 under the
// `protect_important` goal — the D245 protection review.
//
// Same lightweight local CSF shims as the sibling triage/onboarding
// stories so this typechecks without `@storybook/react` installed
// (D210 seeding).
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type { OnboardingFirstTriageMeta } from '@declutrmail/shared/contracts';
import { TRIAGE_QUEUE, type TriageDecisionRow } from '@/features/triage/data';
import { TRIAGE_STATS_KEY } from '@/features/triage/api/use-triage-queue';
import { FIRST_TRIAGE_KEY } from './api/use-onboarding';
import { StepProtectionReview } from './step-protection-review';

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
};

const meta: StoryMeta<typeof StepProtectionReview> = {
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
export const ReassuranceLeads: Story<typeof StepProtectionReview> = {
  render: () =>
    story(ROWS, { pinned: 2, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } }),
};

/**
 * The second connected account — 0 strong / 2 weak. A "we protected 0"
 * headline would be true and useless, so the headline states the fact
 * that exists instead. Zero strong is not an empty review.
 */
export const NoRepliesProtected: Story<typeof StepProtectionReview> = {
  render: () =>
    story(ROWS, { pinned: 2, decided: 0, protection: { strong: 0, weak: 2, manual: 0 } }),
};

/** Nothing weak to review — the reassurance IS the win. */
export const NothingToReview: Story<typeof StepProtectionReview> = {
  render: () =>
    story([], { pinned: 0, decided: 0, protection: { strong: 12, weak: 0, manual: 0 } }),
};

/**
 * Nothing protected at all. Says WHY protection is absent, so an empty
 * result does not read as a broken scan.
 */
export const NothingProtectedYet: Story<typeof StepProtectionReview> = {
  render: () => story([], { pinned: 0, decided: 0, protection: { strong: 0, weak: 0, manual: 0 } }),
};

/**
 * The caught trap: 55 weak protections and not one showable (every
 * candidate decided inside the queue's recent-decision window, or not
 * yet scored). This rendered "Nothing else is protected on a weaker
 * signal" before the end panel learned to branch on the weak count.
 */
export const PlentyToReviewButNoneShowable: Story<typeof StepProtectionReview> = {
  render: () =>
    story([], { pinned: 0, decided: 0, protection: { strong: 460, weak: 55, manual: 0 } }),
};

/** Every pinned row resolved — acted on or unprotected. */
export const Reviewed: Story<typeof StepProtectionReview> = {
  render: () =>
    story([], { pinned: 5, decided: 5, protection: { strong: 460, weak: 50, manual: 0 } }),
};

/**
 * The server took the cleanup branch, so no counts exist. Rows still
 * render; the headline claims nothing it cannot support.
 */
export const CountsNotComputed: Story<typeof StepProtectionReview> = {
  render: () => story(ROWS, { pinned: 2, decided: 0 }),
};
