'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  Eyebrow,
  ScreenIntro,
  Skeleton,
  toast,
  tokens,
} from '@declutrmail/shared';
import { ApiError } from '@/lib/api/client';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { useAutopilotRules } from './api/use-autopilot-rules';
import { useDismissMatch } from './api/use-dismiss-match';
import { usePauseAll } from './api/use-pause-all';
import { usePendingSuggestions } from './api/use-pending-suggestions';
import { PauseConfirmModal } from './pause-confirm-modal';
import { PausedBanner } from './paused-banner';
import { PendingSuggestionRow } from './pending-suggestion-row';
import type { AutopilotScreenState, SuggestionWithRule } from './types';

const { color, font } = tokens;

/**
 * Autopilot screen — D104 Observe-mode tray + D105 master pause.
 *
 * Composition mirrors `SenderDetailRoute` + `SenderDetailPage` (see
 * `apps/web/src/features/senders/detail/sender-detail-page.tsx`):
 *
 *   - `AutopilotRoute` wires the live TanStack queries and routes the
 *     branches into the dumb screen.
 *   - `AutopilotScreen` is the prop-driven render-only component that
 *     Storybook stories and tests drive directly. It owns the
 *     mutations (dismiss + pause-all) so test fixtures can observe the
 *     button states without a query client.
 *
 * Scope at V2:
 *
 *   1. **D104** — surface the pending Observe-mode suggestions buffer
 *      so the founder can see what each rule would have done (and
 *      dismiss individual matches that look wrong).
 *   2. **D105** — pause every rule across every inbox with a single
 *      button. The confirmation renders as a modal preview per D226 —
 *      the action sheet → preview → mutation → undo lifecycle applies
 *      even to admin-grade actions.
 *
 * Out of scope at V2 (deferred to V2.1 per D196/D197):
 *
 *   - Custom rule builder UI
 *   - Per-rule mode toggle UI (observe/active/paused)
 *   - "Approve all and switch to Active" affordance (D104 plan body
 *     describes it, but D10 + D197 keep the activation prompt for
 *     V2.1 since the per-rule day-7 banner UI is itself V2.1).
 */
export function AutopilotRoute() {
  const rulesQuery = useAutopilotRules();
  const suggestionsQuery = usePendingSuggestions();

  const state: AutopilotScreenState = useMemo(() => {
    if (rulesQuery.isLoading || suggestionsQuery.isLoading) {
      return { kind: 'loading' };
    }
    if (rulesQuery.isError || suggestionsQuery.isError) {
      const err = rulesQuery.error ?? suggestionsQuery.error;
      const message =
        err instanceof ApiError
          ? `We couldn't load Autopilot (HTTP ${err.status}).`
          : "We couldn't load Autopilot right now.";
      return { kind: 'error', message };
    }
    const rules = rulesQuery.data ?? [];
    const matches = suggestionsQuery.data ?? [];
    if (rules.length === 0 && matches.length === 0) {
      return { kind: 'empty', rules };
    }
    const ruleById = new Map<string, AutopilotRuleDto>();
    for (const r of rules) ruleById.set(r.id, r);
    const suggestions: SuggestionWithRule[] = matches.map((m) => ({
      match: m,
      rule: ruleById.get(m.ruleId) ?? null,
    }));
    return { kind: 'ready', rules, suggestions };
  }, [
    rulesQuery.isLoading,
    rulesQuery.isError,
    rulesQuery.error,
    rulesQuery.data,
    suggestionsQuery.isLoading,
    suggestionsQuery.isError,
    suggestionsQuery.error,
    suggestionsQuery.data,
  ]);

  return <AutopilotScreen state={state} />;
}

export function AutopilotScreen({ state }: { state: AutopilotScreenState }) {
  const dismissMatch = useDismissMatch();
  const pauseAll = usePauseAll();
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);

  const rules: AutopilotRuleDto[] =
    state.kind === 'ready' || state.kind === 'empty' ? state.rules : [];
  const allPaused = rules.length > 0 && rules.every((r) => r.mode === 'paused');
  const hasRunningRules = rules.some((r) => r.mode !== 'paused');

  const onDismiss = (matchId: string) => {
    dismissMatch.mutate(matchId, {
      onSuccess: () => {
        toast('Suggestion dismissed', 'info');
      },
      onError: (err) => {
        const msg = err instanceof ApiError ? `Dismiss failed (${err.status})` : 'Dismiss failed';
        toast(msg, 'warn');
      },
    });
  };

  const onConfirmPauseAll = () => {
    pauseAll.mutate(undefined, {
      onSuccess: (result) => {
        setPauseConfirmOpen(false);
        toast(`Paused ${result.pausedCount} rule${result.pausedCount === 1 ? '' : 's'}`, 'info');
      },
    });
  };

  const pauseErrorMessage =
    pauseAll.error == null
      ? null
      : pauseAll.error instanceof ApiError
        ? `Pause failed (${pauseAll.error.status}). Please retry.`
        : 'Pause failed. Please retry.';

  return (
    <div
      style={{
        padding: '20px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 980,
        margin: '0 auto',
        fontFamily: font.sans,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <Eyebrow>Autopilot · default mailbox</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '4px 0 0',
            }}
          >
            Suggestions, not actions.
          </h1>
        </div>
        <Button
          tone="default"
          onClick={() => setPauseConfirmOpen(true)}
          disabled={state.kind !== 'ready' || !hasRunningRules}
          ariaLabel="Pause every Autopilot rule"
        >
          Pause all
        </Button>
      </div>

      <ScreenIntro
        id="autopilot"
        title="How Autopilot works"
        body="Each rule watches a slice of your inbox and proposes actions. Until you switch a rule to Active it stays in Observe mode — every match lands here for you to confirm or dismiss. Pause all stops every rule across every inbox at once."
        tip="Custom rules ship in a later release. The five rules at launch cover the common cleanup patterns."
      />

      {allPaused && <PausedBanner rules={rules} />}

      <section
        aria-labelledby="pending-heading"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <h2
            id="pending-heading"
            style={{
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Pending suggestions
          </h2>
          {state.kind === 'ready' && state.suggestions.length > 0 && (
            <span style={{ fontSize: 11.5, color: color.fgMuted, fontFamily: font.mono }}>
              {state.suggestions.length} waiting
            </span>
          )}
        </div>

        {state.kind === 'loading' && <SuggestionsSkeleton />}
        {state.kind === 'error' && <SuggestionsErrorState message={state.message} />}
        {state.kind === 'empty' && <SuggestionsEmptyState hasAnyRules={state.rules.length > 0} />}
        {state.kind === 'ready' && state.suggestions.length === 0 && (
          <SuggestionsEmptyState hasAnyRules={state.rules.length > 0} />
        )}
        {state.kind === 'ready' && state.suggestions.length > 0 && (
          <ul
            aria-label="Pending Autopilot suggestions"
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {state.suggestions.map(({ match, rule }) => (
              <PendingSuggestionRow
                key={match.id}
                match={match}
                rule={rule}
                onDismiss={onDismiss}
                isDismissing={dismissMatch.isPending && dismissMatch.variables === match.id}
              />
            ))}
          </ul>
        )}
      </section>

      <PauseConfirmModal
        open={pauseConfirmOpen}
        rules={rules}
        onCancel={() => {
          if (!pauseAll.isPending) setPauseConfirmOpen(false);
        }}
        onConfirm={onConfirmPauseAll}
        isPausing={pauseAll.isPending}
        pauseError={pauseErrorMessage}
      />
    </div>
  );
}

/** Loading skeleton — three suggestion-row-sized stripes. */
function SuggestionsSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rect" height={60} borderRadius={10} />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading Autopilot suggestions</span>
    </div>
  );
}

/** Error branch — both the rules and suggestions query share this. */
function SuggestionsErrorState({ message }: { message: string }) {
  return <EmptyState title="We couldn't load your Autopilot" body={message} />;
}

/** Empty branch — distinguish "no rules yet" from "no pending matches". */
function SuggestionsEmptyState({ hasAnyRules }: { hasAnyRules: boolean }) {
  if (!hasAnyRules) {
    return (
      <EmptyState
        title="No Autopilot rules yet"
        body="Autopilot rules ship in a later release. When they land, you'll see Observe-mode suggestions here before anything runs."
      />
    );
  }
  return (
    <EmptyState
      title="No pending suggestions"
      body="Every rule is in Observe mode but nothing has matched recently. Suggestions will appear here as Autopilot watches your inbox."
    />
  );
}
