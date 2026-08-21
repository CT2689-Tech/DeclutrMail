'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, tokens, toast } from '@declutrmail/shared';
import type {
  OnboardingGoal,
  OnboardingPresetCatalogItem,
  OnboardingPresetKey,
} from '@declutrmail/shared/contracts';

import { autopilotRulesQueryOptions } from '@/features/autopilot/api/query-options';
import { fetchAutopilotRules } from '@/lib/api/autopilot';
import { captureFeatureException } from '@/lib/sentry';
import { track } from '@/lib/posthog';

import { useSubmitPresetPicks } from './api/use-onboarding';
import { StepShell } from './step-shell';

const { color, font } = tokens;

/** Brief seed-wait poll (D110 sequencing): every 2.5s while empty. */
const RULES_SEED_POLL_MS = 2_500;
/**
 * Give-up bound for the seed poll — ~1 minute at the cadence above.
 * A poll with no terminal condition is a storm waiting for a slow
 * seeder; the user can still continue, and the Autopilot screen shows
 * the rules whenever they land.
 */
const RULES_SEED_MAX_POLLS = 24;

const GOALS: ReadonlyArray<{
  id: OnboardingGoal;
  title: string;
  description: string;
}> = [
  {
    id: 'reduce_newsletters',
    title: 'Reduce newsletters',
    description: 'Prioritize recurring senders you can unsubscribe from or remove.',
  },
  {
    id: 'protect_important',
    title: 'Protect important senders',
    description: 'Review important senders first so you can confirm what stays.',
  },
  {
    id: 'clear_old_promotions',
    title: 'Clear old promotions',
    description: 'Prioritize promotional senders with enough mail to make cleanup worthwhile.',
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
    ...autopilotRulesQueryOptions((signal) => fetchAutopilotRules(signal).then((env) => env.data)),
    refetchInterval: (query) => {
      // Stop on error, and cap the wait (audit 2026-08-21). This read
      // sits behind `CurrentMailboxGuard`, so a scope 409 mid-connect
      // used to loop at 24 req/min indefinitely with no error state and
      // no give-up — under copy promising "your suggestions are still
      // being prepared", a cause this component never read. An empty
      // 200 looped the same way, since "seeder produced nothing" and
      // "not seeded yet" were the same branch.
      if (query.state.status === 'error') return false;
      if ((query.state.data?.length ?? 0) > 0) return false;
      if (query.state.dataUpdateCount + query.state.errorUpdateCount >= RULES_SEED_MAX_POLLS) {
        return false;
      }
      return RULES_SEED_POLL_MS;
    },
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
                ? 'Suggestions saved — nothing changes until you approve it.'
                : 'Saved — you can add rules any time in Autopilot.'
              : 'Selections saved — your suggestions will appear when setup finishes.',
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
      eyebrow="Step 4 of 5 · Optional suggestions"
      title="Choose what DeclutrMail should suggest."
      sub="These are suggestions only. Nothing changes until you approve it. You can turn on automation later in Autopilot."
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
          Your suggestions are still being prepared. Selections made now will appear when they are
          ready.
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
 * Step 4 for tiers without the Autopilot capability (Free, after D251).
 *
 * Persisting an explicit empty pick advances the same server-owned
 * onboarding machine as the preset picker, but this component
 * deliberately never mounts the Autopilot rules query. Free users reach
 * their first real sender review before being introduced to automation.
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
      title="Choose your starting point."
      sub="Your answer helps us pick the first senders worth reviewing. Nothing changes until you approve it."
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
