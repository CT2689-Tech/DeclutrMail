'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { AUTOPILOT_PENDING_PAGE_SIZE } from '@declutrmail/shared/contracts';

import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { useApproveAllForRule } from './api/use-approve-all-for-rule';
import { useApproveMatches } from './api/use-approve-matches';
import { useAutopilotRules } from './api/use-autopilot-rules';
import { useDismissMatch } from './api/use-dismiss-match';
import { usePatchRule } from './api/use-patch-rule';
import { usePauseAll } from './api/use-pause-all';
import { usePendingSuggestions } from './api/use-pending-suggestions';
import { useRulePreview } from './api/use-rule-preview';
import { ActivateRuleModal } from './activate-rule-modal';
import { ApproveConfirmModal } from './approve-confirm-modal';
import { ObserveWindowBanner } from './observe-window-banner';
import { PauseConfirmModal } from './pause-confirm-modal';
import { PausedBanner } from './paused-banner';
import { RuleCard } from './rule-card';
import { SuggestionGroup } from './suggestion-group';
import { track } from '@/lib/posthog';
import { addBreadcrumb, captureFeatureException } from '@/lib/sentry';
import type {
  AutopilotScreenState,
  RulePreviewState,
  RuleSuggestionGroup,
  SuggestionWithRule,
} from './types';

const { color, font } = tokens;

/**
 * BE page cap on GET /api/autopilot/pending-suggestions (D104) —
 * shared constant so the "latest N" honesty copy can't drift from the
 * read-service LIMIT.
 */
const PENDING_BUFFER_CAP = AUTOPILOT_PENDING_PAGE_SIZE;

/**
 * Autopilot screen — D99–D105 (U15).
 *
 * Composition mirrors `SenderDetailRoute` + `SenderDetailPage`:
 *
 *   - `AutopilotRoute` wires the live TanStack queries and routes the
 *     branches into the dumb screen.
 *   - `AutopilotScreen` is the prop-driven component that Storybook
 *     stories and tests drive directly. It owns the mutations so test
 *     fixtures can observe button states without a query client.
 *
 * Surface at V2:
 *
 *   1. **D101 rules management** — the 5 preset rules with enabled
 *      toggle, threshold slider (confidence presets), last-run
 *      summary, pending counts, dry-run preview (D103 scoped per
 *      D192), and Resume for paused rules.
 *   2. **D104 observe-mode buffer** — pending suggestions grouped by
 *      rule with Approve all / Approve selected / per-row Dismiss.
 *      Every approve goes through the mandatory D226 preview modal.
 *   3. **D104 day-7 banner** — rules whose observe window elapsed get
 *      an explicit "Switch to Active" prompt. NO auto-promotion.
 *   4. **D105 master pause** — pause every rule via a previewed modal.
 *
 * Out of scope at V2 (D192/D197/D234): custom rule creation — presets
 * only; the API rejects `is_preset=false`.
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

/** Approve preview target — which rule + which matches the modal covers. */
interface ApproveTarget {
  rule: AutopilotRuleDto;
  matches: AutopilotMatchDto[];
  kind: 'all' | 'selected';
}

export function AutopilotScreen({ state }: { state: AutopilotScreenState }) {
  const dismissMatch = useDismissMatch();
  const pauseAll = usePauseAll();
  const patchRule = usePatchRule();
  const approveMatches = useApproveMatches();
  const approveAllForRule = useApproveAllForRule();
  const rulePreview = useRulePreview();

  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null);
  const [activateTarget, setActivateTarget] = useState<AutopilotRuleDto | null>(null);
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);

  // `mailbox_id: null` — the screen deliberately avoids `useAuth()` so
  // its Storybook stories mount without an auth shim; PostHog
  // `identify` ties the event to the user regardless.
  useEffect(() => {
    void track('page_viewed', { page: 'autopilot', mailbox_id: null });
  }, []);

  const rules: AutopilotRuleDto[] =
    state.kind === 'ready' || state.kind === 'empty' ? state.rules : [];
  const suggestions: SuggestionWithRule[] = state.kind === 'ready' ? state.suggestions : [];
  const allPaused = rules.length > 0 && rules.every((r) => r.mode === 'paused');
  const hasRunningRules = rules.some((r) => r.mode !== 'paused');

  // ── Derivations ────────────────────────────────────────────────────

  /**
   * The pending-suggestions endpoint returns AT MOST 50 rows (newest
   * first — BE cap, autopilot.controller.ts). When the buffer is at
   * the cap, per-rule counts derived from it UNDERCOUNT the true
   * pending totals, so every count the UI shows must say so ("in the
   * latest 50") instead of presenting a page count as a total.
   * (Caught in the U15 smoke: 4,813 pending in the DB rendered as
   * "collected 41 pending suggestions".)
   */
  const pendingBufferTruncated = suggestions.length >= PENDING_BUFFER_CAP;

  const pendingCountByRule = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of suggestions) {
      counts.set(s.match.ruleId, (counts.get(s.match.ruleId) ?? 0) + 1);
    }
    return counts;
  }, [suggestions]);

  /** D104 — suggestions grouped under their rule, rules-list order; orphans last. */
  const groups: RuleSuggestionGroup[] = useMemo(() => {
    const byRule = new Map<string, AutopilotMatchDto[]>();
    for (const s of suggestions) {
      const list = byRule.get(s.match.ruleId) ?? [];
      list.push(s.match);
      byRule.set(s.match.ruleId, list);
    }
    const out: RuleSuggestionGroup[] = [];
    for (const rule of rules) {
      const matches = byRule.get(rule.id);
      if (matches != null) {
        out.push({ rule, matches });
        byRule.delete(rule.id);
      }
    }
    for (const matches of byRule.values()) {
      out.push({ rule: null, matches });
    }
    return out;
  }, [rules, suggestions]);

  /** D104 day-7 banner set — elapsed observe window, still enabled. */
  const elapsedObserveRules = useMemo(
    () => rules.filter((r) => r.enabled && r.mode === 'observe' && r.observeWindowElapsed),
    [rules],
  );

  /** Dry-run panel state for the (single) open preview (D103/D192). */
  const previewState: RulePreviewState | null = useMemo(() => {
    if (previewRuleId == null) return null;
    if (rulePreview.isPending) return { status: 'loading' };
    if (rulePreview.isError) {
      const err = rulePreview.error;
      return {
        status: 'error',
        message:
          err instanceof ApiError
            ? `Dry-run failed (HTTP ${err.status}).`
            : 'Dry-run failed. Please retry.',
      };
    }
    if (rulePreview.data != null && rulePreview.data.ruleId === previewRuleId) {
      return { status: 'ready', result: rulePreview.data };
    }
    return { status: 'loading' };
  }, [
    previewRuleId,
    rulePreview.isPending,
    rulePreview.isError,
    rulePreview.error,
    rulePreview.data,
  ]);

  // ── Rule mutations (D101) ──────────────────────────────────────────

  const savingRuleId =
    patchRule.isPending && patchRule.variables != null ? patchRule.variables.ruleId : null;

  const onToggleEnabled = (rule: AutopilotRuleDto, next: boolean) => {
    void track('autopilot_preset_changed', {
      preset_id: rule.id,
      action: next ? 'enabled' : 'disabled',
    });
    addBreadcrumb({
      category: 'action',
      message: `autopilot: rule ${next ? 'enabled' : 'disabled'}`,
      level: 'info',
    });
    patchRule.mutate(
      { ruleId: rule.id, patch: { enabled: next } },
      {
        onSuccess: () => toast(`Rule ${next ? 'enabled' : 'disabled'}`, 'info'),
        onError: (err) => {
          toast(patchFailureMessage(err), 'warn');
          captureFeatureException(err, { surface: 'autopilot', reason: 'rule_toggle_failed' });
        },
      },
    );
  };

  const onCommitThreshold = (rule: AutopilotRuleDto, value: number) => {
    void track('autopilot_preset_changed', { preset_id: rule.id, action: 'parameter_changed' });
    patchRule.mutate(
      { ruleId: rule.id, patch: { confidenceThreshold: value } },
      {
        onSuccess: () => toast(`Threshold set to ${Math.round(value * 100)}%`, 'info'),
        onError: (err) => {
          toast(patchFailureMessage(err), 'warn');
          captureFeatureException(err, { surface: 'autopilot', reason: 'rule_threshold_failed' });
        },
      },
    );
  };

  const onResume = (rule: AutopilotRuleDto) => {
    void track('autopilot_resumed', { trigger: 'manual' });
    addBreadcrumb({ category: 'action', message: 'autopilot: rule resumed', level: 'info' });
    patchRule.mutate(
      { ruleId: rule.id, patch: { mode: 'observe' } },
      {
        onSuccess: () => toast('Rule resumed — observing again', 'info'),
        onError: (err) => {
          toast(patchFailureMessage(err), 'warn');
          captureFeatureException(err, { surface: 'autopilot', reason: 'rule_resume_failed' });
        },
      },
    );
  };

  // ── Activation (D104 day-7 prompt → D226 preview → PATCH) ─────────

  const onActivateConfirm = () => {
    if (activateTarget == null) return;
    void track('autopilot_preset_changed', { preset_id: activateTarget.id, action: 'activated' });
    addBreadcrumb({
      category: 'action',
      message: 'autopilot: rule switched to active',
      level: 'info',
    });
    patchRule.mutate(
      { ruleId: activateTarget.id, patch: { mode: 'active' } },
      {
        onSuccess: () => {
          setActivateTarget(null);
          toast('Rule is now Active', 'info');
        },
        onError: (err) => {
          captureFeatureException(err, { surface: 'autopilot', reason: 'rule_activate_failed' });
        },
      },
    );
  };

  // ── Approve flow (D104 + D226) ─────────────────────────────────────

  const openApprove = (target: ApproveTarget) => {
    if (target.matches.length === 0) return;
    approveMatches.reset();
    approveAllForRule.reset();
    setApproveTarget(target);
  };

  const isApproving = approveMatches.isPending || approveAllForRule.isPending;

  const onApproveConfirm = () => {
    if (approveTarget == null || isApproving) return;
    const { rule, matches, kind } = approveTarget;
    const count = matches.length;
    const onSuccess = () => {
      void track('autopilot_suggestion_decided', {
        decision: 'accepted',
        suggestion_kind: 'preset_rule',
        count,
      });
      addBreadcrumb({
        category: 'action',
        message: `autopilot: ${count} suggestion(s) approved`,
        level: 'info',
      });
      setApproveTarget(null);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const m of matches) next.delete(m.id);
        return next;
      });
      toast(`Approved ${count} suggestion${count === 1 ? '' : 's'}`, 'info');
    };
    const onError = (err: unknown) => {
      captureFeatureException(err, { surface: 'autopilot', reason: 'approve_failed' });
    };
    if (kind === 'all') {
      approveAllForRule.mutate(rule.id, { onSuccess, onError });
    } else {
      approveMatches.mutate(
        matches.map((m) => m.id),
        { onSuccess, onError },
      );
    }
  };

  const approveError = mutationErrorMessage(
    approveMatches.error ?? approveAllForRule.error,
    'Approve failed. Please retry.',
  );
  const activateError = mutationErrorMessage(
    activateTarget != null ? patchRule.error : null,
    'Activation failed. Please retry.',
  );

  // ── Dismiss (D104) ─────────────────────────────────────────────────

  const onDismiss = (matchId: string) => {
    void track('autopilot_suggestion_decided', {
      decision: 'rejected',
      suggestion_kind: 'preset_rule',
      count: 1,
    });
    addBreadcrumb({
      category: 'action',
      message: `autopilot: suggestion dismissed`,
      level: 'info',
    });
    dismissMatch.mutate(matchId, {
      onSuccess: () => {
        setSelectedIds((prev) => {
          if (!prev.has(matchId)) return prev;
          const next = new Set(prev);
          next.delete(matchId);
          return next;
        });
        toast('Suggestion dismissed', 'info');
      },
      onError: (err) => {
        const msg = err instanceof ApiError ? `Dismiss failed (${err.status})` : 'Dismiss failed';
        toast(msg, 'warn');
        captureFeatureException(err, { surface: 'autopilot', reason: 'dismiss_failed' });
      },
    });
  };

  const onToggleSelect = (matchId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId);
      else next.add(matchId);
      return next;
    });
  };

  // ── Dry-run preview (D103/D192) ────────────────────────────────────

  const onTogglePreview = (rule: AutopilotRuleDto) => {
    if (previewRuleId === rule.id) {
      setPreviewRuleId(null);
      return;
    }
    setPreviewRuleId(rule.id);
    rulePreview.mutate(rule.id);
  };

  const onRetryPreview = (rule: AutopilotRuleDto) => {
    rulePreview.mutate(rule.id);
  };

  // ── Pause-all (D105) ───────────────────────────────────────────────

  const onConfirmPauseAll = () => {
    void track('autopilot_paused', { duration_kind: 'until_resumed' });
    addBreadcrumb({
      category: 'action',
      message: 'autopilot: pause-all confirmed',
      level: 'info',
    });
    pauseAll.mutate(undefined, {
      onSuccess: (result) => {
        setPauseConfirmOpen(false);
        toast(`Paused ${result.pausedCount} rule${result.pausedCount === 1 ? '' : 's'}`, 'info');
      },
      onError: (err) => {
        captureFeatureException(err, { surface: 'autopilot', reason: 'pause_all_failed' });
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
        body="Each rule watches a slice of your inbox and proposes actions. Until you switch a rule to Active it stays in Observe mode — every match lands here for you to approve or dismiss. Pause all stops every rule across every inbox at once."
        tip="Custom rules ship in a later release. The five rules at launch cover the common cleanup patterns."
      />

      {allPaused && <PausedBanner rules={rules} />}

      {state.kind === 'ready' && (
        <ObserveWindowBanner
          rules={elapsedObserveRules}
          pendingCountByRule={pendingCountByRule}
          pendingApproximate={pendingBufferTruncated}
          onActivate={(rule) => {
            patchRule.reset();
            setActivateTarget(rule);
          }}
        />
      )}

      {/* Whole-surface failure — one designed error block, not one per
          section (the two reads share a fate; guard 4xx never retries). */}
      {state.kind === 'error' && <SuggestionsErrorState message={state.message} />}

      {state.kind !== 'error' && (
        <>
          {/* Rules management (D101) */}
          <section
            aria-labelledby="rules-heading"
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <h2
              id="rules-heading"
              style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}
            >
              Rules
            </h2>
            {state.kind === 'loading' && <RulesSkeleton />}
            {state.kind === 'empty' && (
              <EmptyState
                title="No Autopilot rules yet"
                description="The five preset rules are seeded when your mailbox finishes its first sync. Once they land, they observe quietly and their suggestions appear here."
              />
            )}
            {state.kind === 'ready' && rules.length > 0 && (
              <ul
                aria-label="Autopilot rules"
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {rules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    pendingCount={pendingCountByRule.get(rule.id) ?? 0}
                    pendingApproximate={pendingBufferTruncated}
                    isSaving={savingRuleId === rule.id}
                    onToggleEnabled={(next) => onToggleEnabled(rule, next)}
                    onCommitThreshold={(value) => onCommitThreshold(rule, value)}
                    onResume={() => onResume(rule)}
                    previewOpen={previewRuleId === rule.id}
                    preview={previewRuleId === rule.id ? previewState : null}
                    onTogglePreview={() => onTogglePreview(rule)}
                    onRetryPreview={() => onRetryPreview(rule)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Pending suggestions (D104) */}
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
              {state.kind === 'ready' && suggestions.length > 0 && (
                <span style={{ fontSize: 11.5, color: color.fgMuted, fontFamily: font.mono }}>
                  {suggestions.length}
                  {pendingBufferTruncated ? '+' : ''} waiting
                </span>
              )}
            </div>

            {state.kind === 'loading' && <SuggestionsSkeleton />}
            {state.kind === 'empty' && (
              <SuggestionsEmptyState hasAnyRules={state.rules.length > 0} />
            )}
            {state.kind === 'ready' && suggestions.length === 0 && (
              <SuggestionsEmptyState hasAnyRules={rules.length > 0} />
            )}
            {state.kind === 'ready' && groups.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {groups.map((group) => (
                  <SuggestionGroup
                    key={group.rule?.id ?? `orphan-${group.matches[0]?.ruleId ?? 'none'}`}
                    rule={group.rule}
                    matches={group.matches}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onDismiss={onDismiss}
                    dismissingMatchId={
                      dismissMatch.isPending ? (dismissMatch.variables ?? null) : null
                    }
                    onApproveAll={(rule, matches) => openApprove({ rule, matches, kind: 'all' })}
                    onApproveSelected={(rule, matches) =>
                      openApprove({ rule, matches, kind: 'selected' })
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

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

      {approveTarget != null && (
        <ApproveConfirmModal
          rule={approveTarget.rule}
          matches={approveTarget.matches}
          isApproving={isApproving}
          error={approveError}
          onCancel={() => {
            if (!isApproving) setApproveTarget(null);
          }}
          onConfirm={onApproveConfirm}
        />
      )}

      <ActivateRuleModal
        rule={activateTarget}
        pendingCount={activateTarget != null ? (pendingCountByRule.get(activateTarget.id) ?? 0) : 0}
        pendingApproximate={pendingBufferTruncated}
        isActivating={activateTarget != null && patchRule.isPending}
        error={activateError}
        onCancel={() => {
          if (!patchRule.isPending) setActivateTarget(null);
        }}
        onConfirm={onActivateConfirm}
      />
    </div>
  );
}

/** PATCH failure toast copy — shared by toggle/threshold/resume. */
function patchFailureMessage(err: unknown): string {
  return err instanceof ApiError ? `Couldn't save (${err.status})` : "Couldn't save the rule";
}

/** Modal-error string from a mutation error (null when no error). */
function mutationErrorMessage(err: unknown, fallback: string): string | null {
  if (err == null) return null;
  return err instanceof ApiError ? `${fallback.replace('.', '')} (HTTP ${err.status}).` : fallback;
}

/** Loading skeleton — rule-card-sized stripes. */
function RulesSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rect" height={92} borderRadius={10} />
      ))}
      <span style={{ position: 'absolute', left: -9999 }}>Loading Autopilot rules</span>
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
  return <EmptyState title="We couldn't load your Autopilot" description={message} />;
}

/** Empty branch — distinguish "no rules yet" from "no pending matches". */
function SuggestionsEmptyState({ hasAnyRules }: { hasAnyRules: boolean }) {
  if (!hasAnyRules) {
    return (
      <EmptyState
        title="No pending suggestions"
        description="Suggestions appear here once your preset rules are seeded and start observing your inbox."
      />
    );
  }
  return (
    <EmptyState
      title="No pending suggestions"
      description="Every rule is watching but nothing has matched recently. Suggestions will appear here as Autopilot observes your inbox."
    />
  );
}
