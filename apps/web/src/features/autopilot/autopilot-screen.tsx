'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Eyebrow,
  ScreenIntro,
  Skeleton,
  toast,
  tokens,
} from '@declutrmail/shared';
import { AUTOPILOT_PENDING_PAGE_SIZE } from '@declutrmail/shared/contracts';
import { ApiError } from '@/lib/api/client';

import type {
  AutopilotMatchDto,
  AutopilotRuleDto,
  AutopilotRulePreviewResultDto,
} from '@/lib/api/autopilot';
import { ContextualHelp } from '@/features/help/contextual-help';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import {
  TIER_MANIFEST,
  hasCapability,
  minimumTierForCapability,
  undoWindowDaysFor,
} from '@declutrmail/shared/entitlements';

import { useApproveAllForRule } from './api/use-approve-all-for-rule';
import { useApproveMatches } from './api/use-approve-matches';
import { useAutopilotRules } from './api/use-autopilot-rules';
import { useDismissMatch } from './api/use-dismiss-match';
import { usePatchRule } from './api/use-patch-rule';
import { usePatternSuggestion } from './api/use-pattern-suggestion';
import { useDecidePatternSuggestion } from './api/use-decide-pattern-suggestion';
import { usePauseAll } from './api/use-pause-all';
import { usePendingSuggestions } from './api/use-pending-suggestions';
import { useRulePreview } from './api/use-rule-preview';
import { ActivateRuleModal } from './activate-rule-modal';
import { ApproveConfirmModal } from './approve-confirm-modal';
import { ObserveWindowBanner } from './observe-window-banner';
import { PauseConfirmModal } from './pause-confirm-modal';
import { PausedBanner } from './paused-banner';
import { PatternSuggestionCard } from './pattern-suggestion-card';
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

/**
 * The plan that grants unattended action, derived so a ladder move
 * rewrites every mention at once (design-gate 2026-08-04 — four
 * hardcoded "Pro" strings sat beside a banner that already derived it).
 */
const ACT_PLAN_NAME = TIER_MANIFEST[minimumTierForCapability('autopilot-active')].name;

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
 *      rule with Approve all / Approve selected / per-row Skip suggestion.
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
  const patternQuery = usePatternSuggestion();
  const refetchRules = rulesQuery.refetch;
  const refetchSuggestions = suggestionsQuery.refetch;
  const refetchPattern = patternQuery.refetch;
  const retry = useCallback(() => {
    void Promise.allSettled([refetchRules(), refetchSuggestions(), refetchPattern()]);
  }, [refetchRules, refetchSuggestions, refetchPattern]);

  const state: AutopilotScreenState = useMemo(() => {
    if (rulesQuery.isLoading || suggestionsQuery.isLoading || patternQuery.isLoading) {
      return { kind: 'loading' };
    }
    if (rulesQuery.isError || suggestionsQuery.isError || patternQuery.isError) {
      const err = rulesQuery.error ?? suggestionsQuery.error ?? patternQuery.error;
      const message =
        err instanceof ApiError
          ? "We couldn't load Autopilot."
          : "We couldn't load Autopilot right now.";
      return { kind: 'error', message, retry };
    }
    const rules = rulesQuery.data ?? [];
    const matches = suggestionsQuery.data ?? [];
    if (rules.length === 0 && matches.length === 0) {
      return { kind: 'empty', rules, patternSuggestion: patternQuery.data ?? null };
    }
    const ruleById = new Map<string, AutopilotRuleDto>();
    for (const r of rules) ruleById.set(r.id, r);
    const suggestions: SuggestionWithRule[] = matches.map((m) => ({
      match: m,
      rule: ruleById.get(m.ruleId) ?? null,
    }));
    return { kind: 'ready', rules, suggestions, patternSuggestion: patternQuery.data ?? null };
  }, [
    rulesQuery.isLoading,
    rulesQuery.isError,
    rulesQuery.error,
    rulesQuery.data,
    suggestionsQuery.isLoading,
    suggestionsQuery.isError,
    suggestionsQuery.error,
    suggestionsQuery.data,
    patternQuery.isLoading,
    patternQuery.isError,
    patternQuery.error,
    patternQuery.data,
    retry,
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
  const auth = useOptionalAuth();
  const activeMailboxId = auth?.me.activeMailboxId ?? null;
  // Which mailbox these rules run on — makes a multi-mailbox switch
  // visible in the header instead of a static "default mailbox" that
  // was wrong for every account after the first.
  const activeEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const dismissMatch = useDismissMatch();
  const pauseAll = usePauseAll();
  const patchRule = usePatchRule();
  const approveMatches = useApproveMatches();
  const approveAllForRule = useApproveAllForRule();
  const rulePreview = useRulePreview();
  // Separate mutation instance for the activation modal's first-sweep
  // preview (D226) — the rule card's inline panel and the modal must
  // not stomp each other's state.
  const activatePreview = useRulePreview();
  // D251 — Plus reaches this screen via `autopilot` and may review
  // and approve matches, but only `autopilot-active` (Pro) may let a rule act
  // unattended. Without this the screen offers Activate to Plus, the
  // PATCH 402s, and the modal quotes Pro's 30-day undo window to a user
  // who has 7.
  // Read the tier from the auth context the screen already consumes rather
  // than `useTier()`, which pulls in `useAuth()` and would make this screen
  // un-renderable wherever auth is only optionally present. Same source of
  // truth, one fewer dependency. Absent tier → treat as not entitled, so a
  // skewed /me payload hides Activate rather than offering a 402.
  const canActivate = hasCapability(auth?.me.tier ?? 'free', 'autopilot-active');
  const decidePattern = useDecidePatternSuggestion();

  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null);
  /**
   * The rule whose D226 preview is open, and WHY.
   *
   * One piece of state for both entry points — turning a rule on, and
   * promoting an already-watching rule — because both commit the same
   * decision behind the same mandatory dry-run. Two states would let
   * the two paths drift apart, and the preview is the thing that must
   * not drift.
   */
  const [confirmTarget, setConfirmTarget] = useState<{
    rule: AutopilotRuleDto;
    intent: 'enable' | 'activate';
  } | null>(null);
  /**
   * Which of the modal's two commits is running. The frame needs it to
   * put the busy label on the button the user actually clicked — one
   * shared `isPending` made the acting button claim to run when the
   * user had chosen Watch first.
   */
  const [pendingCommit, setPendingCommit] = useState<'primary' | 'secondary' | undefined>(
    undefined,
  );
  const [previewRuleId, setPreviewRuleId] = useState<string | null>(null);
  const shownPatternKeys = useRef<Set<string>>(new Set());

  // `mailbox_id: null` preserves the page-view event contract. Optional
  // auth above is used only to scope suggestion-impression dedupe and
  // keeps Storybook stories mountable without an auth shim.
  useEffect(() => {
    void track('page_viewed', { page: 'autopilot', mailbox_id: null });
  }, []);

  const rules: AutopilotRuleDto[] =
    state.kind === 'ready' || state.kind === 'empty' ? state.rules : [];
  const suggestions: SuggestionWithRule[] = state.kind === 'ready' ? state.suggestions : [];
  const patternSuggestion =
    state.kind === 'ready' || state.kind === 'empty' ? (state.patternSuggestion ?? null) : null;
  const allPaused = rules.length > 0 && rules.every((r) => r.mode === 'paused');
  // "Pause all" is only meaningful for rules that could actually run.
  // Without the `enabled` term a workspace whose rules are all switched
  // off still offered an enabled Pause-all button, which pauses nothing
  // a user can observe.
  const hasRunningRules = rules.some((r) => r.enabled && r.mode !== 'paused');

  useEffect(() => {
    if (patternSuggestion == null) return;
    const impressionKey = `${activeMailboxId ?? 'unknown'}:${patternSuggestion.ruleId}`;
    if (shownPatternKeys.current.has(impressionKey)) return;
    shownPatternKeys.current.add(impressionKey);
    void track('autopilot_pattern_suggestion_shown', {
      preset_key: patternSuggestion.presetKey,
      evidence_count: patternSuggestion.evidenceCount,
    });
  }, [activeMailboxId, patternSuggestion]);

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

  /**
   * D10 day-7 prompt set — elapsed observe window, still enabled, NOT
   * dismissed, and ≥1 pending match (the uncapped server digest — a
   * silent week earns no prompt).
   */
  const elapsedObserveRules = useMemo(
    () =>
      rules.filter(
        (r) =>
          r.enabled &&
          r.mode === 'observe' &&
          r.observeWindowElapsed &&
          r.observePromptDismissedAt == null &&
          (r.observeDigest?.pendingTotal ?? 0) > 0,
      ),
    [rules],
  );

  /** Dry-run panel state for the (single) open preview (D103/D192). */
  const previewState: RulePreviewState | null = useMemo(() => {
    if (previewRuleId == null) return null;
    return derivePreviewState(rulePreview, previewRuleId);
  }, [previewRuleId, rulePreview]);

  /** First-sweep preview state for the activation modal (D226). */
  const activatePreviewState: RulePreviewState = useMemo(() => {
    if (confirmTarget == null) return { status: 'loading' };
    return derivePreviewState(activatePreview, confirmTarget.rule.id);
  }, [confirmTarget, activatePreview]);

  // ── Rule mutations (D101) ──────────────────────────────────────────

  const savingRuleId =
    patchRule.isPending && patchRule.variables != null ? patchRule.variables.ruleId : null;

  /**
   * Turning a rule ON is a D226 mutation — it starts changing mail — so
   * it goes through the mandatory preview, where the user also chooses
   * whether it acts or watches. Turning a rule OFF changes no mail and
   * is fully reversible, so it commits immediately; putting a preview
   * in front of "stop doing things" would be ceremony, not safety.
   */
  const onToggleEnabled = (rule: AutopilotRuleDto, next: boolean) => {
    if (next) {
      openConfirm(rule, 'enable');
      return;
    }
    void track('autopilot_preset_changed', { preset_id: rule.id, action: 'disabled' });
    addBreadcrumb({ category: 'action', message: 'autopilot: rule disabled', level: 'info' });
    patchRule.mutate(
      { ruleId: rule.id, patch: { enabled: false } },
      {
        onSuccess: () => toast('Rule disabled', 'info'),
        onError: (err) => {
          toast(patchFailureMessage(err), 'warn');
          captureFeatureException(err, { surface: 'autopilot', reason: 'rule_toggle_failed' });
        },
      },
    );
  };

  const onCommitThreshold = async (rule: AutopilotRuleDto, value: number): Promise<boolean> => {
    void track('autopilot_preset_changed', { preset_id: rule.id, action: 'parameter_changed' });
    try {
      await patchRule.mutateAsync({ ruleId: rule.id, patch: { confidenceThreshold: value } });
      toast(`Threshold set to ${Math.round(value * 100)}%`, 'info');
      return true;
    } catch (err) {
      toast(patchFailureMessage(err), 'warn');
      captureFeatureException(err, { surface: 'autopilot', reason: 'rule_threshold_failed' });
      // Reported to the slider so it snaps back — a warn toast alone
      // leaves the control showing a threshold the rule never took.
      return false;
    }
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

  // ── Activation (D10 day-7 prompt → D226 preview → PATCH) ──────────

  /**
   * Opening the modal ALSO fires the first-sweep dry-run — the D226
   * preview the confirm button gates on (`activatePreviewState`).
   */
  const openConfirm = (rule: AutopilotRuleDto, intent: 'enable' | 'activate') => {
    patchRule.reset();
    activatePreview.reset();
    setPendingCommit(undefined);
    setConfirmTarget({ rule, intent });
    activatePreview.mutate(rule.id);
  };

  const openActivate = (rule: AutopilotRuleDto) => openConfirm(rule, 'activate');

  /**
   * Commit whatever the open preview was gating.
   *
   * `enabled` and `mode` go in ONE patch on purpose. Turning a rule on
   * and choosing how it runs is a single user decision; two sequential
   * PATCHes would leave a window where the rule is on in whichever mode
   * the row happened to hold, and the second call can fail.
   */
  const commitConfirm = (mode: 'observe' | 'active', source: 'primary' | 'secondary') => {
    // Re-entrancy guard, matching `onApproveConfirm`. The buttons do
    // disable once `patchRule.isPending` flips, but two commit paths
    // widen the window between click and re-render.
    if (confirmTarget == null || patchRule.isPending) return;
    const { rule, intent } = confirmTarget;
    // Tracked by which BUTTON was pressed, not by the mode. Under-tier,
    // the PRIMARY button commits `observe`, so deriving the source from
    // the mode would put the busy label on a button that isn't there.
    setPendingCommit(source);
    const patch = intent === 'enable' ? { enabled: true, mode } : { mode };
    void track('autopilot_preset_changed', {
      preset_id: rule.id,
      action: intent === 'enable' ? 'enabled' : 'activated',
    });
    addBreadcrumb({
      category: 'action',
      message: `autopilot: rule ${intent === 'enable' ? `enabled in ${mode}` : 'switched to active'}`,
      level: 'info',
    });
    patchRule.mutate(
      { ruleId: rule.id, patch },
      {
        onSuccess: () => {
          setConfirmTarget(null);
          setPendingCommit(undefined);
          toast(
            mode === 'active'
              ? intent === 'enable'
                ? 'Rule is on and running'
                : 'Rule is now Active'
              : 'Rule is on and watching — nothing moves until you approve',
            'info',
          );
        },
        onError: (err) => {
          setPendingCommit(undefined);
          captureFeatureException(err, {
            surface: 'autopilot',
            reason: intent === 'enable' ? 'rule_enable_failed' : 'rule_activate_failed',
          });
        },
      },
    );
  };

  /** D10 — persist the day-7 prompt dismissal on the rule row. */
  const onDismissPrompt = (rule: AutopilotRuleDto) => {
    void track('autopilot_suggestion_decided', {
      decision: 'rejected',
      suggestion_kind: 'preset_change',
      count: 1,
    });
    addBreadcrumb({
      category: 'action',
      message: 'autopilot: day-7 prompt dismissed',
      level: 'info',
    });
    patchRule.mutate(
      { ruleId: rule.id, patch: { observePromptDismissed: true } },
      {
        onSuccess: () => toast('Prompt dismissed — the rule keeps observing', 'info'),
        onError: (err) => {
          toast(patchFailureMessage(err), 'warn');
          captureFeatureException(err, { surface: 'autopilot', reason: 'prompt_dismiss_failed' });
        },
      },
    );
  };

  /** Rule whose prompt-dismiss PATCH is in flight (banner button state). */
  const dismissingPromptRuleId =
    patchRule.isPending && patchRule.variables?.patch.observePromptDismissed === true
      ? patchRule.variables.ruleId
      : null;

  /**
   * The modal's PRIMARY commit.
   *
   * Which mutation that is depends on entitlement, and the decision
   * belongs here rather than in the modal: without `autopilot-active`
   * there is no acting path to offer, so turning a rule on can only
   * mean Observe. The modal hides the acting label to match; both must
   * agree or the button lies about what it does.
   */
  const onActivateConfirm = () =>
    commitConfirm(
      confirmTarget?.intent === 'enable' && !canActivate ? 'observe' : 'active',
      'primary',
    );

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
    // 'all' is an UNCAPPED server-side update — matches.length is at
    // most the 50-row page, so the toast/analytics count MUST come from
    // the server's approvedCount (D226 honesty; 2026-07-16 audit).
    const onSuccess = (result: { approvedCount: number }) => {
      const count = kind === 'all' ? result.approvedCount : matches.length;
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
      toast(
        `Approved ${count.toLocaleString('en-US')} suggestion${count === 1 ? '' : 's'}`,
        'info',
      );
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
    confirmTarget != null ? patchRule.error : null,
    confirmTarget?.intent === 'enable'
      ? 'Could not turn the rule on. Please retry.'
      : 'Activation failed. Please retry.',
  );

  // ── Skip suggestion (D104; API state remains `dismissed`) ──────────

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
        toast('Suggestion skipped — Gmail was not changed', 'info');
      },
      onError: (err) => {
        toast("Couldn't skip the suggestion. Try again.", 'warn');
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

  const pauseErrorMessage = pauseAll.error == null ? null : 'Pause failed. Please retry.';

  const onPatternDecision = (decision: 'observe' | 'dismissed') => {
    if (!patternSuggestion) return;
    decidePattern.mutate(
      { ruleId: patternSuggestion.ruleId, decision },
      {
        onSuccess: (result) => {
          void track('autopilot_pattern_suggestion_decided', {
            preset_key: result.presetKey,
            decision: result.decision,
            evidence_count: result.evidenceCount,
          });
          toast(
            decision === 'observe'
              ? 'Rule is observing — Gmail has not changed.'
              : 'Suggestion dismissed — Gmail has not changed.',
            'info',
          );
        },
        onError: (err) => {
          toast('That suggestion was not changed. Please retry.', 'warn');
          captureFeatureException(err, {
            surface: 'autopilot',
            reason: 'pattern_suggestion_decision_failed',
          });
        },
      },
    );
  };

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
          <Eyebrow>{activeEmail ? `Autopilot · ${activeEmail}` : 'Autopilot'}</Eyebrow>
          <h1
            style={{
              fontFamily: font.display,
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '-0.018em',
              margin: '4px 0 0',
            }}
          >
            {canActivate
              ? 'Preview it. Then let it run.'
              : 'Rules find it. You approve each batch.'}
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

      {/* Both explainers are tier-conditional: the under-tier wording must
          never promise unattended action, which is a per-rule setting that
          tier cannot reach — a promise that always fails, the same defect
          class as offering the Activate button.

          2026-08-23: the entitled copy no longer teaches "starts in
          Observe, switch to Active later". Turning a rule on now shows the
          first-sweep preview and asks which way it should run, so telling
          a user their rule begins by doing nothing would describe a flow
          the screen does not have. */}
      <ScreenIntro
        id="autopilot"
        title="How Autopilot works"
        body={
          canActivate
            ? 'Turning a rule on shows exactly what it would do to email already in your inbox. Confirm and it acts, then keeps acting on matching email that arrives — or choose Watch first and it collects matches for your approval instead.'
            : `Rules collect matching email in Observe for you to approve. Rules that act on future matches on their own are part of ${ACT_PLAN_NAME}.`
        }
      />

      <ContextualHelp
        question={canActivate ? 'What does "Watch first" do?' : 'What does Observe do?'}
      >
        {canActivate ? (
          <>
            Watch first turns the rule on in Observe: it records matches as suggestions and changes
            no Gmail email until you approve them. Confirming instead lets the rule act on the first
            sweep you just previewed, and on matching email that arrives after it. A watching rule
            can be switched over later — turn it off and on again, or use the prompt that appears
            once it has collected matches; the suggestions it collected stay pending for you to
            approve or skip.
          </>
        ) : (
          <>
            Observe records matches as suggestions and changes no Gmail email until you approve
            them. Suggestions stay pending until you approve or skip each batch. Rules that apply
            future matches automatically — Active mode — are part of {ACT_PLAN_NAME}.
          </>
        )}
      </ContextualHelp>

      {patternSuggestion && (
        <PatternSuggestionCard
          suggestion={patternSuggestion}
          pendingDecision={decidePattern.isPending ? decidePattern.variables.decision : null}
          onObserve={() => onPatternDecision('observe')}
          onDismiss={() => onPatternDecision('dismissed')}
        />
      )}

      {allPaused && <PausedBanner rules={rules} />}

      {state.kind === 'ready' && (
        <ObserveWindowBanner
          rules={elapsedObserveRules}
          onActivate={openActivate}
          onDismiss={onDismissPrompt}
          dismissingRuleId={dismissingPromptRuleId}
          canActivate={canActivate}
        />
      )}

      {/* Whole-surface failure — one designed error block, not one per
          section. The two reads share a fate and retry explicitly. */}
      {state.kind === 'error' && (
        <ErrorState
          title="We couldn't load your Autopilot"
          description={state.message}
          onRetry={state.retry}
        />
      )}

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
                description="The five preset rules appear after your mailbox finishes its first sync. Matching senders then appear here as suggestions."
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
                    canActivate={canActivate}
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
          kind={approveTarget.kind}
          pendingTotal={approveTarget.rule.observeDigest?.pendingTotal ?? null}
          pendingApproximate={pendingBufferTruncated}
          isApproving={isApproving}
          error={approveError}
          onCancel={() => {
            if (!isApproving) setApproveTarget(null);
          }}
          onConfirm={onApproveConfirm}
        />
      )}

      <ActivateRuleModal
        rule={confirmTarget?.rule ?? null}
        intent={confirmTarget?.intent ?? 'activate'}
        canRunUnattended={canActivate}
        pendingAction={pendingCommit}
        pendingCount={
          confirmTarget != null ? (pendingCountByRule.get(confirmTarget.rule.id) ?? 0) : 0
        }
        pendingApproximate={pendingBufferTruncated}
        preview={activatePreviewState}
        undoWindowDays={undoWindowDaysFor(auth?.me.tier ?? 'free')}
        onRetryPreview={() => {
          if (confirmTarget != null) activatePreview.mutate(confirmTarget.rule.id);
        }}
        onWatchFirst={() => commitConfirm('observe', 'secondary')}
        isActivating={confirmTarget != null && patchRule.isPending}
        error={activateError}
        onCancel={() => {
          if (!patchRule.isPending) {
            setConfirmTarget(null);
            setPendingCommit(undefined);
          }
        }}
        onConfirm={onActivateConfirm}
      />
    </div>
  );
}

/** PATCH failure toast copy — shared by toggle/threshold/resume. */
function patchFailureMessage(_err: unknown): string {
  return "Couldn't save the rule";
}

/**
 * Dry-run mutation → panel state, shared by the rule-card inline panel
 * and the activation modal (D103/D226) so the two surfaces derive the
 * loading/error/ready branches identically. Stale data from a PREVIOUS
 * rule (mismatched `ruleId`) renders as loading, never as ready.
 */
function derivePreviewState(
  mutation: {
    isPending: boolean;
    isError: boolean;
    error: unknown;
    data: AutopilotRulePreviewResultDto | undefined;
  },
  ruleId: string,
): RulePreviewState {
  if (mutation.isPending) return { status: 'loading' };
  if (mutation.isError) {
    return {
      status: 'error',
      message: 'Preview failed. Please retry.',
    };
  }
  if (mutation.data != null && mutation.data.ruleId === ruleId) {
    return { status: 'ready', result: mutation.data };
  }
  return { status: 'loading' };
}

/** Modal-error string from a mutation error (null when no error). */
function mutationErrorMessage(err: unknown, fallback: string): string | null {
  if (err == null) return null;
  return fallback;
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

/** Empty branch — distinguish "no rules yet" from "no pending matches". */
function SuggestionsEmptyState({ hasAnyRules }: { hasAnyRules: boolean }) {
  if (!hasAnyRules) {
    return (
      <EmptyState
        title="No pending suggestions"
        description="Suggestions appear here after your preset rules are created and matching senders are found."
      />
    );
  }
  return (
    <EmptyState
      title="No pending suggestions"
      description="No sender currently matches an enabled rule. New matches will appear here."
    />
  );
}
