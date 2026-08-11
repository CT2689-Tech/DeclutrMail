// Storybook CSF3 stories for the D38 first-run verb tour.
//
// The three states D38 turns on, all driven by the REAL flag through
// the REAL query key — stubbing the hook would let a story claim a
// state the component cannot actually reach:
//
//   • FirstRun  — flag null: the tour a new user meets at step 5
//   • Dismissed — flag set: renders nothing, which IS the decision
//                 ("Day 2+: no re-education"). Shown beside a caption
//                 so an empty frame reads as the assertion it is.
//   • Replayed  — the Settings re-trigger, same panel in its dialog
//
// The verb rows are generated from the D245 action semantics, so these
// stories show the shipped sentences rather than story-local copy.

import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { tokens } from '@declutrmail/shared';
import type { OnboardingState } from '@declutrmail/shared/contracts';

import { ONBOARDING_STATE_KEY } from '@/features/onboarding/api/use-onboarding';
import { OnboardingVerbTour, VerbTourDialog } from './verb-tour';

const { color, font } = tokens;

const meta: Meta<typeof OnboardingVerbTour> = {
  title: 'Onboarding/VerbTour',
  component: OnboardingVerbTour,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'D38 first-time education: an inline tour shown once during onboarding step 5, naming each of the five decisions, the key that triggers it, and what it does to the sender’s mail. It never renders again once finished or skipped; Settings can re-open it on demand.',
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof OnboardingVerbTour>;

function stateWith(verbTourCompletedAt: string | null): OnboardingState {
  return {
    onboardedAt: null,
    skipped: false,
    goal: 'reduce_newsletters',
    presetPicks: [],
    presets: [],
    verbTourCompletedAt,
  };
}

/** Seeds the REAL onboarding-state key; the hook reads straight through. */
function Seeded({
  verbTourCompletedAt,
  children,
}: {
  verbTourCompletedAt: string | null;
  children: React.ReactNode;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(ONBOARDING_STATE_KEY, stateWith(verbTourCompletedAt));
  return (
    <QueryClientProvider client={client}>
      <div style={{ background: color.bg, minHeight: 420, padding: 16 }}>{children}</div>
    </QueryClientProvider>
  );
}

/** A user who has never seen it — step 5, first run. */
export const FirstRun: Story = {
  render: () => (
    <Seeded verbTourCompletedAt={null}>
      <OnboardingVerbTour />
    </Seeded>
  ),
};

/**
 * Finished or skipped. The frame is deliberately empty — that absence
 * is the whole of D38's "no re-education", so it gets a story.
 */
export const Dismissed: Story = {
  render: () => (
    <Seeded verbTourCompletedAt="2026-08-01T09:00:00.000Z">
      <p style={{ fontFamily: font.sans, fontSize: 13, color: color.fgMuted, margin: 0 }}>
        Nothing renders below this line — the tour has been seen.
      </p>
      <OnboardingVerbTour />
    </Seeded>
  ),
};

/** Settings → “Replay the tour”, for a user whose flag is already set. */
export const Replayed: Story = {
  render: () => (
    <Seeded verbTourCompletedAt="2026-08-01T09:00:00.000Z">
      <VerbTourDialog onClose={() => {}} />
    </Seeded>
  ),
};
