'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNow } from '@/lib/use-now';
import { Button, tokens, useIsAtMost } from '@declutrmail/shared';
import { TIER_MANIFEST, minimumTierForCapability } from '@declutrmail/shared/entitlements';
import type { AutopilotActionKind, AutopilotRuleDto } from '@/lib/api/autopilot';
import { observeDigestSummary } from './observe-digest';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, font, motion, text } = tokens;

/** The plan granting unattended action — derived, never hardcoded. */
const ACT_PLAN_NAME = TIER_MANIFEST[minimumTierForCapability('autopilot-active')].name;

/**
 * One preset rule in the D101 rules-management list — a quiet row:
 * name + status word + enabled switch, a one-line description, then
 * "Preview matches" (D103 dry-run, scoped to presets per D192) and a
 * Resume affordance for paused rules. The rest of D101's surface —
 * last-run summary, pending-match count, the D10 observe-window
 * countdown, the Observe digest and the confidence-threshold slider —
 * sits behind the row's Details disclosure.
 *
 * Mode changes that START automation (observe/paused → active) do NOT
 * live here — activation is the day-7 banner's explicit, previewed
 * flow (D226). This card's mutations (enable/disable, threshold,
 * resume-to-observe) never move mail, so they PATCH directly.
 *
 * Presentational: all mutations arrive as callbacks so Storybook and
 * tests can drive every state without a query client.
 */
export function RuleCard({
  rule,
  canActivate,
  pendingCount,
  pendingApproximate,
  isSaving,
  onToggleEnabled,
  onCommitThreshold,
  onResume,
  previewOpen,
  preview,
  onTogglePreview,
  onRetryPreview,
}: {
  rule: AutopilotRuleDto;
  /**
   * D251 — whether this workspace's rules may act unattended
   * (`autopilot-active`, Pro). On Plus an `active` rule is skipped by the apply
   * worker, so the card must not render it as running.
   */
  canActivate: boolean;
  /** Pending Observe-mode suggestions currently buffered for this rule. */
  pendingCount: number;
  /**
   * True when the pending buffer hit the BE's 50-row page cap — the
   * count is then a floor, not a total, and the copy must say so.
   */
  pendingApproximate: boolean;
  /** True while any PATCH for THIS rule is in flight. */
  isSaving: boolean;
  onToggleEnabled: (next: boolean) => void;
  /**
   * Fires on slider release with the new threshold in [0,1]. Resolves
   * `true` when the server accepted the PATCH, `false` when it rejected
   * it — the slider snaps back on `false` so the control never shows a
   * threshold the rule doesn't actually have.
   */
  onCommitThreshold: (value: number) => Promise<boolean>;
  /** Paused → Observe (a fresh 7-day observe window starts). */
  onResume: () => void;
  previewOpen: boolean;
  preview: RulePreviewState | null;
  onTogglePreview: () => void;
  onRetryPreview: () => void;
}) {
  const now = useNow();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const name = presetDisplayName(rule.presetKey, rule.name);
  // D10/D101 — Observe-mode digest, only meaningful while the rule is
  // actually watching (enabled + Observe). Disabled rules stay quiet.
  const digestSummary = rule.enabled ? observeDigestSummary(rule) : null;
  const observeSummary = observeWindowSummary(rule, now);
  const explanation = ruleModeExplanation(rule, canActivate);
  const detailsId = `rule-details-${rule.id}`;

  return (
    <li
      data-rule-id={rule.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '14px 0',
        borderTop: `1px solid ${color.line}`,
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: text.md, fontWeight: 600, color: color.fg }}>{name}</span>
          <ModeStatus rule={rule} canActivate={canActivate} />
        </div>
        <EnabledSwitch
          ruleName={name}
          enabled={rule.enabled}
          disabled={isSaving}
          onToggle={() => onToggleEnabled(!rule.enabled)}
        />
      </div>

      {/* The one-line description: what it does, and how it is running.
          This is where Watching vs Active is explained — at the rule,
          not in a page preamble. */}
      <p style={{ margin: 0, fontSize: text.sm, lineHeight: 1.5, color: color.fgMuted }}>
        {describeRuleAction(rule.actionKind)}
        {explanation === null ? '' : ` · ${explanation}`}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {rule.mode === 'paused' && (
          <Button
            tone="default"
            size="sm"
            onClick={onResume}
            disabled={isSaving}
            ariaLabel={`Resume rule ${name}`}
          >
            {isSaving ? 'Resuming…' : 'Resume'}
          </Button>
        )}
        <QuietButton
          onClick={onTogglePreview}
          ariaLabel={`${previewOpen ? 'Hide' : 'Preview'} matches for rule ${name}`}
        >
          {previewOpen ? 'Hide preview' : 'Preview matches'}
        </QuietButton>
        <QuietButton
          onClick={() => setDetailsOpen((open) => !open)}
          ariaLabel={`${detailsOpen ? 'Hide' : 'Show'} details for rule ${name}`}
          ariaExpanded={detailsOpen}
          ariaControls={detailsId}
        >
          {detailsOpen ? 'Hide details' : 'Details'}
        </QuietButton>
      </div>

      {detailsOpen && (
        <div
          id={detailsId}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: text.sm,
            color: color.fgMuted,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>{lastRunSummary(rule, now !== null)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {pendingApproximate
                ? `${pendingCount}+ pending`
                : `${pendingCount} pending suggestion${pendingCount === 1 ? '' : 's'}`}
            </span>
            {observeSummary != null && (
              <>
                <span aria-hidden="true">·</span>
                <span>{observeSummary}</span>
              </>
            )}
          </div>

          {/* D10/D101 — Observe-mode digest: what a sweep right now would do. */}
          {digestSummary != null && <div style={{ color: color.fgSoft }}>{digestSummary}</div>}

          {rule.confidenceThreshold != null && (
            <ThresholdSlider
              ruleName={name}
              committed={rule.confidenceThreshold}
              disabled={isSaving}
              onCommit={onCommitThreshold}
            />
          )}
        </div>
      )}

      {previewOpen && preview != null && (
        <RulePreviewPanel ruleName={name} state={preview} onRetry={onRetryPreview} />
      )}
    </li>
  );
}

/** Text-weight row action — quieter than a bordered button in a list. */
function QuietButton({
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaControls,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  ariaExpanded?: boolean;
  ariaControls?: string;
  children: ReactNode;
}) {
  const isMobile = useIsAtMost('sm');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      style={{
        // Quiet on desktop; a full 44px touch target on phones.
        minHeight: isMobile ? 44 : 28,
        padding: 0,
        background: 'transparent',
        border: 'none',
        color: color.primary,
        fontFamily: font.sans,
        fontSize: text.sm,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/** Canonical-verb description of the rule's action (D227 — K/A/U/L/D only). */
function describeRuleAction(kind: AutopilotActionKind): string {
  switch (kind) {
    case 'archive':
      return 'Archives';
    case 'unsubscribe':
      return 'Unsubscribes';
    case 'later':
      return 'Moves to Later';
  }
}

/** Rule lifecycle status — Observing / Active / Not running / Paused (D10, D251). */
function ModeStatus({ rule, canActivate }: { rule: AutopilotRuleDto; canActivate: boolean }) {
  // A disabled rule keeps whatever mode it had — `{enabled:false}` does
  // not reset it — so an off rule could read "Active" while taking no
  // actions. Since turning a rule on defaults to acting, off-but-active
  // is the ordinary end state of enable-then-disable.
  // The switch beside it already reads "Off"; a second "Off" is noise.
  if (!rule.enabled) return null;
  let label = 'Observing';
  let tone: string = color.fgMuted;
  if (rule.mode === 'paused') {
    label = 'Paused';
    tone = color.amberDeep;
  } else if (rule.mode === 'active') {
    // D251 — the apply worker skips `active` rules on a tier without
    // `autopilot-active` (the Pro→Plus downgrade path). "Active" here
    // would assert automation that is not happening.
    label = canActivate ? 'Active' : 'Not running';
    tone = canActivate ? color.primary : color.amberDeep;
  }
  return <span style={{ fontSize: text.sm, fontWeight: 500, color: tone }}>{label}</span>;
}

/**
 * Rule-local mode explanation — users should not have to remember a
 * page intro. Null for a rule that is off — the switch already says so.
 */
function ruleModeExplanation(rule: AutopilotRuleDto, canActivate: boolean): string | null {
  if (!rule.enabled) return null;
  if (rule.mode === 'paused') return 'Does nothing until you resume it.';
  if (rule.mode === 'active') {
    if (!canActivate) {
      // Copy contract (Codex stop-review ×5): no absolute claims. "Keep
      // waiting for approval" — false, the demotion dismisses the
      // backlog. "Are cleared" — false, in-flight work is untouched.
      // "With its normal undo" — false for Unsubscribe, one-way (D58).
      // "Still completes" — false, work can fail at the boundary.
      // "Result lands in Activity" — false too: EXECUTION_VERBS
      // excludes unsubscribe and no-op terminals write no Activity row.
      // 2026-09-19 brevity sweep: the in-flight clause is gone rather
      // than qualified — the line now says nothing about work underway.
      return `Acting on its own is part of ${ACT_PLAN_NAME}, so this rule starts no new work. It returns to Observe and collects fresh matches for your approval.`;
    }
    return 'Future matches run automatically; results appear in Activity.';
  }
  return 'Matches become suggestions for your approval.';
}

/**
 * "Last run Jun 9 · 14 matched · 7 senders" / "Hasn't run yet".
 *
 * `lastRunActions` is written by the apply worker as
 * `matchesForRule.length` — the MATCH count, in both Observe and
 * Active mode. Calling it "actions" was false twice over: an Observe
 * run performs no Gmail action at all (a rule sitting Off would read
 * "4,768 actions"), and an Active run enqueues intents that can still
 * fail. Activity is the ledger of what actually happened; this line
 * reports what the rule matched.
 */
function lastRunSummary(rule: AutopilotRuleDto, localizeDate: boolean): string {
  if (rule.lastRunAt == null) return "Hasn't run yet";
  const d = new Date(rule.lastRunAt);
  const when = !localizeDate
    ? 'recorded'
    : Number.isNaN(d.getTime())
      ? rule.lastRunAt
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Last run ${when} · ${rule.lastRunActions} matched · ${rule.lastRunSenders} sender${rule.lastRunSenders === 1 ? '' : 's'}`;
}

/** D10 observe-window countdown; null when not in Observe mode. */
function observeWindowSummary(rule: AutopilotRuleDto, now: number | null): string | null {
  if (rule.mode !== 'observe' || rule.observeWindowEndsAt == null) return null;
  if (rule.observeWindowElapsed) return 'Observe window complete';
  if (now === null) return null;
  const ends = new Date(rule.observeWindowEndsAt).getTime();
  if (Number.isNaN(ends)) return null;
  const daysLeft = Math.max(1, Math.ceil((ends - now) / (24 * 60 * 60 * 1000)));
  return `Observing · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
}

/**
 * Switch-style enabled toggle (D101 "single toggle"). Toggling off
 * stops the matcher from producing new matches; nothing in the inbox
 * moves either way, so this PATCHes directly without a D226 preview
 * (the preview ladder applies to mail-mutating actions).
 */
function EnabledSwitch({
  ruleName,
  enabled,
  disabled,
  onToggle,
}: {
  ruleName: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} rule ${ruleName}`}
      onClick={onToggle}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: text.sm, color: color.fgMuted, minWidth: 20, textAlign: 'right' }}>
        {enabled ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 22,
          borderRadius: 999,
          background: enabled ? color.primary : color.mutedBg,
          border: `1px solid ${enabled ? color.primary : color.border}`,
          position: 'relative',
          transition: `background ${motion.fast} ${motion.ease}`,
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: enabled ? 16 : 2,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: enabled ? color.fgInverse : color.fgMuted,
            transition: `left ${motion.fast} ${motion.ease}`,
          }}
        />
      </span>
    </button>
  );
}

/**
 * D101 confidence-threshold slider for the two confidence-gated
 * presets. Local state while dragging; the PATCH fires once on
 * release/blur (not per pixel) so the API sees one write per
 * adjustment. Range mirrors D100's engine-confidence vocabulary
 * (0.5–1.0).
 */
function ThresholdSlider({
  ruleName,
  committed,
  disabled,
  onCommit,
}: {
  ruleName: string;
  committed: number;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
}) {
  const [value, setValue] = useState(committed);
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the server value changes (another tab, refetch) —
  // but NEVER while the user is interacting with the slider. A commit
  // triggers a rules refetch, and without this guard the refetched
  // value stomps the user's in-flight keyboard/drag adjustment
  // (caught live in the U15 smoke: click-commit → refetch → reset →
  // the follow-up arrow keys were silently discarded).
  useEffect(() => {
    if (document.activeElement === inputRef.current) return;
    setValue(committed);
  }, [committed]);

  const commit = () => {
    if (value === committed) return;
    const attempted = value;
    const previous = committed;
    void onCommit(attempted).then((accepted) => {
      // Server rejected the PATCH — snap back to the value the rule
      // still has. Without this the slider keeps rendering the failed
      // value (the refetch returns the OLD threshold, so the re-sync
      // effect above sees an unchanged `committed` and never fires),
      // leaving the control asserting a threshold that isn't real.
      // Skip when the user has already moved on to another value.
      if (!accepted) setValue((cur) => (cur === attempted ? previous : cur));
    });
  };

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: text.sm,
        color: color.fgMuted,
      }}
    >
      <span>Confidence ≥</span>
      <input
        ref={inputRef}
        type="range"
        min={0.5}
        max={0.99}
        step={0.01}
        value={value}
        disabled={disabled}
        aria-label={`Confidence threshold for rule ${ruleName}`}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onBlur={commit}
        style={{ width: 120, accentColor: color.primary }}
      />
      <span
        style={{
          fontFamily: font.mono,
          fontSize: text.sm,
          color: color.fgSoft,
          minWidth: 32,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {Math.round(value * 100)}%
      </span>
    </label>
  );
}
