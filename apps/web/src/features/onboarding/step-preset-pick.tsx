'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, tokens, toast } from '@declutrmail/shared';
import type {
  OnboardingGoal,
  OnboardingPresetCatalogItem,
  OnboardingPresetKey,
} from '@declutrmail/shared/contracts';

import { autopilotKeys } from '@/features/autopilot/api/query-keys';
import { fetchAutopilotRules } from '@/lib/api/autopilot';
import { captureFeatureException } from '@/lib/sentry';
import { track } from '@/lib/posthog';

import { useSubmitPresetPicks } from './api/use-onboarding';
import { StepShell } from './step-shell';

const { color, font } = tokens;

/** Brief seed-wait poll (D110 sequencing): every 2.5s while empty. */
const RULES_SEED_POLL_MS = 2_500;

const GOALS: ReadonlyArray<{
  id: OnboardingGoal;
  title: string;
  description: string;
}> = [
  {
    id: 'reduce_newsletters',
    title: 'Reduce newsletters',
    description: 'Start with recurring senders that are easiest to review.',
  },
  {
    id: 'protect_important',
    title: 'Protect important senders',
    description: 'Start with people and senders you are most likely to keep.',
  },
  {
    id: 'clear_old_promotions',
    title: 'Clear old promotions',
    description: 'Start with promotional senders and archive decisions.',
  },
];

/** Verb chip labels — K/A/U/L only (§2.2). */
const VERB_LABEL: Record<OnboardingPresetCatalogItem['verb'], string> = {
  keep: 'Keep',
  archive: 'Archive',
  unsubscribe: 'Unsubscribe',
  later: 'Later',
};

/**
 * Step 4 — starting-rules pick (D110, adapted per the launch buildout
 * to present the 5 D101 preset rules directly, observe-mode-first per
 * D10: every rule starts in Observe and only ever suggests until the
 * user flips it Active on the Autopilot screen).
 *
 * Persistence design (the "cannot silently lose the choice" shape):
 * the submit endpoint FIRST writes the picks to `users.preferences`,
 * THEN reconciles whatever preset rules already exist. When the
 * post-sync seeder hasn't created the rules yet, the seeder itself
 * reads the persisted picks at seed time — so submitting before the
 * seed is safe, and the UI says so honestly instead of blocking.
 *
 * The brief rules poll exists only to make the common path (sync
 * completed ⇒ rules seeded moments ago) reconcile immediately.
 */
export function StepPresetPick({
  presets,
  initialGoal = null,
  onSubmitted,
  corner,
}: {
  presets: OnboardingPresetCatalogItem[];
  initialGoal?: OnboardingGoal | null;
  onSubmitted: () => void;
  corner?: ReactNode;
}) {
  const [picked, setPicked] = useState<ReadonlySet<OnboardingPresetKey>>(new Set());
  const [goal, setGoal] = useState<OnboardingGoal | null>(initialGoal);
  const submit = useSubmitPresetPicks();

  // Same key as the Autopilot screen so the cache is shared; the poll
  // stops the moment the seeder has run (or immediately, when rules
  // already exist).
  const rules = useQuery({
    queryKey: autopilotKeys.rules(),
    queryFn: ({ signal }) => fetchAutopilotRules(signal).then((env) => env.data),
    refetchInterval: (query) =>
      query.state.data && query.state.data.length > 0 ? false : RULES_SEED_POLL_MS,
  });
  const rulesSeeded = (rules.data?.length ?? 0) > 0;

  const toggle = (key: OnboardingPresetKey) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const onContinue = () => {
    if (submit.isPending || goal === null) return;
    submit.mutate(
      { goal, presetKeys: [...picked] },
      {
        onSuccess: (result) => {
          void track('activation_goal_selected', { goal: result.goal });
          toast(
            result.rulesSeeded
              ? result.presetKeys.length > 0
                ? 'Rules saved — they start in Observe mode.'
                : 'Saved — you can add rules any time in Autopilot.'
              : 'Choices saved — they apply automatically once your rules finish setting up.',
            'success',
          );
          onSubmitted();
        },
        onError: (err) => {
          captureFeatureException(err, { surface: 'onboarding', reason: 'preset_picks' });
          toast("Couldn't save your picks — try again.", 'warn');
        },
      },
    );
  };

  return (
    <StepShell
      eyebrow="Step 4 of 5 · Starting rules"
      title="Pick your starting rules."
      sub="Every rule starts in Observe mode — it only suggests, you approve. Nothing is archived or unsubscribed without you. Change any of this later in Autopilot."
      maxWidth={560}
      corner={corner}
    >
      <GoalSelector value={goal} onChange={setGoal} />
      <div
        role="group"
        aria-label="Starting rules"
        style={{ display: 'grid', gap: 10, width: '100%', marginBottom: 20 }}
      >
        {presets.map((preset) => {
          const isOn = picked.has(preset.key);
          return (
            <button
              key={preset.key}
              type="button"
              aria-pressed={isOn}
              onClick={() => toggle(preset.key)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                textAlign: 'left',
                padding: '14px 16px',
                background: isOn ? color.primarySoft : color.card,
                border: `1px solid ${isOn ? color.primaryBorder : color.lineSoft}`,
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: font.sans,
                color: color.fg,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  flexShrink: 0,
                  marginTop: 1,
                  borderRadius: 5,
                  border: `1.5px solid ${isOn ? color.primary : color.line}`,
                  background: isOn ? color.primary : 'transparent',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontSize: 12,
                  lineHeight: 1,
                }}
              >
                {isOn ? '✓' : ''}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <strong style={{ fontWeight: 600, fontSize: 14 }}>{preset.name}</strong>
                  <span
                    style={{
                      fontFamily: font.mono,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: color.fgMuted,
                      border: `1px solid ${color.lineSoft}`,
                      borderRadius: 4,
                      padding: '1px 6px',
                    }}
                  >
                    {VERB_LABEL[preset.verb]}
                  </span>
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13,
                    color: color.fgMuted,
                    marginTop: 3,
                    lineHeight: 1.5,
                  }}
                >
                  {preset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Honest seed status — never blocks submission (picks persist
          in preferences and the seeder applies them; see docblock). */}
      {!rules.isLoading && !rulesSeeded && (
        <p style={{ color: color.fgMuted, fontSize: 12, margin: '0 0 14px', maxWidth: 460 }}>
          Your rules are still being prepared in the background — picks made now apply automatically
          the moment they're ready.
        </p>
      )}

      <Button
        tone="primary"
        onClick={onContinue}
        disabled={submit.isPending || goal === null}
        style={{ minWidth: 220 }}
      >
        {submit.isPending
          ? 'Saving…'
          : goal === null
            ? 'Choose a goal to continue'
            : picked.size > 0
              ? `Continue with ${picked.size} ${picked.size === 1 ? 'rule' : 'rules'}`
              : 'Continue without rules'}
      </Button>
    </StepShell>
  );
}

/**
 * Step 4 for tiers without the Pro Autopilot capability.
 *
 * Persisting an explicit empty pick advances the same server-owned
 * onboarding machine as the Pro picker, but this component deliberately
 * never mounts the Autopilot rules query. Free and Plus users reach their
 * first real sender review before being introduced to automation.
 */
export function StepFirstSenderReview({
  initialGoal = null,
  onSubmitted,
  corner,
}: {
  onSubmitted: () => void;
  initialGoal?: OnboardingGoal | null;
  corner?: ReactNode;
}) {
  const submit = useSubmitPresetPicks();
  const [goal, setGoal] = useState<OnboardingGoal | null>(initialGoal);

  const onContinue = () => {
    if (submit.isPending || goal === null) return;
    submit.mutate(
      { goal, presetKeys: [] },
      {
        onSuccess: (result) => {
          void track('activation_goal_selected', { goal: result.goal });
          toast("Ready — let's review your first sender.", 'success');
          onSubmitted();
        },
        onError: (err) => {
          captureFeatureException(err, { surface: 'onboarding', reason: 'preset_picks' });
          toast("Couldn't continue — try again.", 'warn');
        },
      },
    );
  };

  return (
    <StepShell
      eyebrow="Step 4 of 5 · First review"
      title="Your first sender review is ready."
      sub="We'll start with no automated rules so you can see exactly how DeclutrMail organizes your inbox. Next, review a real sender and choose what should happen."
      maxWidth={560}
      corner={corner}
    >
      <GoalSelector value={goal} onChange={setGoal} />
      <Button
        tone="primary"
        onClick={onContinue}
        disabled={submit.isPending || goal === null}
        style={{ minWidth: 220 }}
      >
        {submit.isPending
          ? 'Getting it ready…'
          : goal === null
            ? 'Choose a goal to continue'
            : 'Review my first sender'}
      </Button>
    </StepShell>
  );
}

function GoalSelector({
  value,
  onChange,
}: {
  value: OnboardingGoal | null;
  onChange: (goal: OnboardingGoal) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="What would help most right now?"
      style={{ display: 'grid', gap: 10, width: '100%', marginBottom: 24 }}
    >
      <p style={{ margin: 0, color: color.fg, fontSize: 14, fontWeight: 600 }}>
        What would help most right now?
      </p>
      {GOALS.map((goal) => {
        const selected = value === goal.id;
        return (
          <button
            key={goal.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(goal.id)}
            style={{
              textAlign: 'left',
              padding: '12px 14px',
              borderRadius: 10,
              border: `1px solid ${selected ? color.primaryBorder : color.lineSoft}`,
              background: selected ? color.primarySoft : color.card,
              color: color.fg,
              cursor: 'pointer',
              fontFamily: font.sans,
            }}
          >
            <strong style={{ display: 'block', fontSize: 14 }}>{goal.title}</strong>
            <span style={{ display: 'block', color: color.fgMuted, fontSize: 12, marginTop: 3 }}>
              {goal.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
