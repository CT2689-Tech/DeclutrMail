'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Pill, tokens } from '@declutrmail/shared';
import type { AutopilotActionKind, AutopilotRuleDto } from '@/lib/api/autopilot';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, font } = tokens;

/**
 * One preset rule in the D101 rules-management list.
 *
 * Surfaces per D101: enabled toggle, threshold slider (confidence-
 * gated presets only), last-run summary, pending-match count, mode
 * pill with the D10 observe-window countdown, dry-run "Preview
 * matches" (D103 scoped to presets per D192), and a Resume affordance
 * for paused rules (the PausedBanner's "re-enable from the rules
 * list").
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
  /** Fires on slider release with the new threshold in [0,1]. */
  onCommitThreshold: (value: number) => void;
  /** Paused → Observe (a fresh 7-day observe window starts). */
  onResume: () => void;
  previewOpen: boolean;
  preview: RulePreviewState | null;
  onTogglePreview: () => void;
  onRetryPreview: () => void;
}) {
  const name = presetDisplayName(rule.presetKey, rule.name);

  return (
    <li
      data-rule-id={rule.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: color.card,
        border: `1px solid ${color.lineSoft}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: color.fg }}>{name}</span>
          <Pill tone="default">{describeRuleAction(rule.actionKind)}</Pill>
          <ModePill rule={rule} />
        </div>
        <EnabledSwitch
          ruleName={name}
          enabled={rule.enabled}
          disabled={isSaving}
          onToggle={() => onToggleEnabled(!rule.enabled)}
        />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          fontSize: 11.5,
          color: color.fgMuted,
        }}
      >
        <span>{lastRunSummary(rule)}</span>
        <span aria-hidden="true">·</span>
        <span>
          {pendingApproximate
            ? `${pendingCount} pending in the latest 50`
            : `${pendingCount} pending suggestion${pendingCount === 1 ? '' : 's'}`}
        </span>
        {observeWindowSummary(rule) != null && (
          <>
            <span aria-hidden="true">·</span>
            <span>{observeWindowSummary(rule)}</span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {rule.confidenceThreshold != null && (
          <ThresholdSlider
            ruleName={name}
            committed={rule.confidenceThreshold}
            disabled={isSaving}
            onCommit={onCommitThreshold}
          />
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
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
          <Button
            tone="default"
            size="sm"
            onClick={onTogglePreview}
            ariaLabel={`${previewOpen ? 'Hide' : 'Preview'} matches for rule ${name}`}
          >
            {previewOpen ? 'Hide preview' : 'Preview matches'}
          </Button>
        </div>
      </div>

      {previewOpen && preview != null && (
        <RulePreviewPanel ruleName={name} state={preview} onRetry={onRetryPreview} />
      )}
    </li>
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

/** Rule lifecycle pill — Observing / Active / Paused (D10). */
function ModePill({ rule }: { rule: AutopilotRuleDto }) {
  if (rule.mode === 'paused') return <Pill tone="amber">Paused</Pill>;
  if (rule.mode === 'active') return <Pill tone="emerald">Active</Pill>;
  return <Pill tone="default">Observing</Pill>;
}

/** "Last run Jun 9 · 14 actions · 7 senders" / "Hasn't run yet". */
function lastRunSummary(rule: AutopilotRuleDto): string {
  if (rule.lastRunAt == null) return "Hasn't run yet";
  const d = new Date(rule.lastRunAt);
  const when = Number.isNaN(d.getTime())
    ? rule.lastRunAt
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `Last run ${when} · ${rule.lastRunActions} action${rule.lastRunActions === 1 ? '' : 's'} · ${rule.lastRunSenders} sender${rule.lastRunSenders === 1 ? '' : 's'}`;
}

/** D10 observe-window countdown; null when not in Observe mode. */
function observeWindowSummary(rule: AutopilotRuleDto): string | null {
  if (rule.mode !== 'observe' || rule.observeWindowEndsAt == null) return null;
  if (rule.observeWindowElapsed) return 'Observe window complete';
  const ends = new Date(rule.observeWindowEndsAt).getTime();
  if (Number.isNaN(ends)) return null;
  const daysLeft = Math.max(1, Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000)));
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
        gap: 7,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: font.sans,
      }}
    >
      <span style={{ fontSize: 11, color: color.fgMuted, minWidth: 20, textAlign: 'right' }}>
        {enabled ? 'On' : 'Off'}
      </span>
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          background: enabled ? color.primary : color.mutedBg,
          border: `1px solid ${enabled ? color.primary : color.border}`,
          position: 'relative',
          transition: 'background 120ms',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1,
            left: enabled ? 15 : 1,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: '#FFFFFF',
            boxShadow: '0 1px 2px rgba(14,20,19,0.25)',
            transition: 'left 120ms',
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
  onCommit: (value: number) => void;
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
    if (value !== committed) onCommit(value);
  };

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11.5,
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
          fontSize: 11.5,
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
