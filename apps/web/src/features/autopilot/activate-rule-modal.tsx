'use client';

import { TIER_MANIFEST, tokens } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, font } = tokens;
const AUTOPILOT_UNDO_WINDOW_DAYS = TIER_MANIFEST.pro.undoWindowDays;

/**
 * D226 mandatory preview for switching a rule Observe → Active — the
 * one mutation on this screen that STARTS automated mail actions, so
 * the preview spells out exactly what changes:
 *
 *   - **First-sweep dry-run** — the SAME `POST /rules/:id/preview`
 *     endpoint the rule card uses (it materializes the identical
 *     signals the apply worker reads), rendered inside the sheet:
 *     would-match count + top senders. Confirm is GATED on the
 *     preview resolving — the user never activates blind, and a
 *     failed preview offers retry instead of unlocking the button.
 *   - Going forward, new matches are approved and executed
 *     automatically (verb-specific copy below, honest per verb: only
 *     one-click unsubscribes auto-send; mailto stays manual per D230).
 *   - Suggestions already collected during the Observe window stay
 *     pending — activation does NOT bulk-approve them (the BE keeps
 *     the two mutations separate; "Approve all" lives on the group).
 *
 * Confirm fires `PATCH mode='active'`.
 */
export function ActivateRuleModal({
  rule,
  pendingCount,
  pendingApproximate,
  preview,
  onRetryPreview,
  isActivating,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto | null;
  pendingCount: number;
  /** True when the pending buffer hit the BE's 50-row cap (count is a floor). */
  pendingApproximate: boolean;
  /** First-sweep dry-run state — fired by the opener when the modal opens. */
  preview: RulePreviewState;
  onRetryPreview: () => void;
  isActivating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (rule == null) return null;
  const name = presetDisplayName(rule.presetKey, rule.name);

  return (
    <ConfirmModalFrame
      open
      titleId="dm-activate-title"
      title={`Switch "${name}" to Active`}
      lead="The rule stops asking and starts acting. Here is exactly what changes:"
      footnote="Pause any time — the rule card's toggle or Pause all."
      confirmLabel="Switch to Active"
      confirmBusyLabel="Switching…"
      canConfirm={preview.status === 'ready'}
      isBusy={isActivating}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 12.5,
          color: color.fgSoft,
          lineHeight: 1.5,
        }}
      >
        <li>{goingForwardCopy(rule)}</li>
        <li>
          {pendingApproximate
            ? 'Suggestions already collected stay pending below — activating does not approve them. Approve or skip them separately.'
            : `The ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'} already collected ${
                pendingCount === 1 ? 'stays' : 'stay'
              } pending below — activating does not approve ${
                pendingCount === 1 ? 'it' : 'them'
              }. Approve or skip ${pendingCount === 1 ? 'it' : 'them'} separately.`}
        </li>
        <li>Senders you mark Protected are always skipped.</li>
      </ul>

      {/* D226 — what the FIRST active sweep would do right now (same
          signal materializer as the apply worker). Confirm stays
          disabled until this resolves. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: color.fgMuted,
            fontFamily: font.sans,
          }}
        >
          First sweep, right now
        </span>
        <RulePreviewPanel ruleName={name} state={preview} onRetry={onRetryPreview} />
        <ActivationReport rule={rule} preview={preview} />
      </div>
    </ConfirmModalFrame>
  );
}

/** Decision-grade report shown only after the server dry-run resolves. */
function ActivationReport({
  rule,
  preview,
}: {
  rule: AutopilotRuleDto;
  preview: RulePreviewState;
}) {
  if (preview.status !== 'ready') return null;
  const { result } = preview;
  const weeklyCopy =
    result.weeklyVolume.basis === 'observed_7d'
      ? `7-day observed volume: ${result.weeklyVolume.observedMatches.toLocaleString()} match${
          result.weeklyVolume.observedMatches === 1 ? '' : 'es'
        }.`
      : `Early weekly estimate: about ${result.weeklyVolume.estimatedMatches.toLocaleString()} match${
          result.weeklyVolume.estimatedMatches === 1 ? '' : 'es'
        }, extrapolated from ${result.weeklyVolume.observedMatches.toLocaleString()} over ${
          result.weeklyVolume.observedDays
        } day${result.weeklyVolume.observedDays === 1 ? '' : 's'}.`;

  return (
    <section
      aria-labelledby="dm-activation-report-title"
      style={{
        border: `1px solid ${color.line}`,
        borderRadius: 9,
        padding: '12px 14px',
        background: color.paper,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: font.sans,
      }}
    >
      <h3
        id="dm-activation-report-title"
        style={{ margin: 0, fontSize: 12.5, color: color.fg, fontFamily: font.sans }}
      >
        Activation report
      </h3>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>
        {actionableNowCopy(rule, result.actionableSenderCount, result.actionableMessageCount)}
      </div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>
        {result.protectedWouldMatchCount.toLocaleString()} additional matching sender
        {result.protectedWouldMatchCount === 1 ? ' is' : 's are'} Protected and will be skipped.
      </div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>{weeklyCopy}</div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>
        Daily safety cap: {result.dailyActionCap.toLocaleString()} action
        {result.dailyActionCap === 1 ? '' : 's'}. Extra matches wait for a later sweep.
      </div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>{recoveryCopy(rule)}</div>
    </section>
  );
}

function actionableNowCopy(
  rule: AutopilotRuleDto,
  senderCount: number,
  messageCount: number,
): string {
  if (rule.actionKind === 'unsubscribe') {
    return `${senderCount.toLocaleString()} unsubscribe request${
      senderCount === 1 ? '' : 's'
    } actionable now. Those senders currently account for ${messageCount.toLocaleString()} inbox message${
      messageCount === 1 ? '' : 's'
    }; unsubscribing does not remove existing mail.`;
  }
  return `${senderCount.toLocaleString()} sender${senderCount === 1 ? '' : 's'} and ${messageCount.toLocaleString()} inbox message${messageCount === 1 ? '' : 's'} actionable now.`;
}

function recoveryCopy(rule: AutopilotRuleDto): string {
  if (rule.actionKind === 'archive') {
    return `Recovery: archive results can be undone from Activity for ${AUTOPILOT_UNDO_WINDOW_DAYS} days.`;
  }
  if (rule.actionKind === 'later') {
    return `Recovery: Later results return automatically at their scheduled time and can be undone from Activity for ${AUTOPILOT_UNDO_WINDOW_DAYS} days.`;
  }
  return 'Recovery: unsubscribe requests cannot be undone. Existing messages stay in your inbox unless a separate archive action applies.';
}

/** Verb-honest description of Active mode (D227 canonical verbs; D230 mailto stays manual). */
function goingForwardCopy(rule: AutopilotRuleDto): string {
  const presentation = buildActionPresentation({
    verb: rule.actionKind,
    liveCount: null,
    planUndoDeadline: null,
    wakeAt: rule.actionKind === 'later' ? defaultLaterWakeAtIso() : null,
    unsubscribeChannel: null,
  });
  return `For each new match: ${presentation.previewCopy}`;
}
