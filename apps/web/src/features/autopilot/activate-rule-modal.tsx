'use client';

import { tokens } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';
import { RulePreviewPanel } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, font } = tokens;

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
  intent = 'activate',
  canRunUnattended = true,
  pendingAction,
  pendingCount,
  pendingApproximate,
  preview,
  undoWindowDays,
  onRetryPreview,
  onWatchFirst,
  isActivating,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto | null;
  /**
   * Which mutation this preview is gating.
   *
   *   `'enable'`   — the rule is OFF. Confirm turns it on AND sets
   *                  `mode='active'`, so the very first sweep acts.
   *                  `onWatchFirst` turns it on in Observe instead.
   *   `'activate'` — the rule is already on in Observe; confirm only
   *                  promotes it. This is the day-7 banner's path.
   *
   * One modal, because the DECISION is identical either way: "here is
   * what this rule would do to mail that is already here, and it will
   * keep doing it to mail that arrives". Splitting it into two
   * components would have duplicated the dry-run panel and the
   * per-verb recovery copy, and those are exactly the parts that must
   * never drift between the two entry points.
   */
  intent?: 'enable' | 'activate';
  /**
   * Whether this workspace may let rules act unattended
   * (`autopilot-active`). When false the acting path is not offered at
   * all — turning a rule on commits Observe.
   *
   * No tier is in that position under the current manifest. It is wired
   * because every OTHER Activate entry point is gated this way, and the
   * enable path was not: a one-line re-tier of `autopilot-active` would
   * otherwise put an always-402 button in the modal's PRIMARY slot,
   * re-creating the exact defect the D251 gate was built for. The
   * comments elsewhere in this change promise that re-tiering stays a
   * config edit; this is what makes that true here.
   */
  canRunUnattended?: boolean;
  /** Which commit is in flight — drives the busy label on the right button. */
  pendingAction?: 'primary' | 'secondary' | undefined;
  pendingCount: number;
  /** True when the pending buffer hit the BE's 50-row cap (count is a floor). */
  pendingApproximate: boolean;
  /**
   * The CALLER'S undo window, in days. Passed in rather than read from
   * `TIER_MANIFEST.pro` — this file used to hardcode Pro's window on the
   * reasoning that only Pro could open the modal, which stopped being
   * true the moment `autopilot-active` moved to Plus (2026-08-23). The
   * recovery line below is a promise about the reader's own account, so
   * it has to come from the reader's own tier.
   */
  undoWindowDays: number;
  /** First-sweep dry-run state — fired by the opener when the modal opens. */
  preview: RulePreviewState;
  onRetryPreview: () => void;
  /**
   * Turn the rule on in Observe instead of acting. Only meaningful for
   * `intent='enable'`; the second button is hidden without it.
   *
   * Observe is a CHOICE here, not a tier: watching first is what a
   * cautious user picks, not what a cheaper plan is limited to.
   */
  onWatchFirst?: () => void;
  isActivating: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (rule == null) return null;
  const name = presetDisplayName(rule.presetKey, rule.name);

  const enabling = intent === 'enable';
  // Turning a rule on without the unattended capability can only mean
  // Observe, so the acting label and the second button both disappear
  // rather than offering a commit that would 402.
  const enablingToAct = enabling && canRunUnattended;

  return (
    <ConfirmModalFrame
      open
      titleId="dm-activate-title"
      title={enabling ? `Turn on "${name}"` : `Switch "${name}" to Active`}
      lead={
        enablingToAct
          ? 'The rule acts on matching mail already in your inbox, and keeps acting on matching mail that arrives. Here is exactly what changes:'
          : enabling
            ? 'The rule starts collecting matches for your approval. Nothing moves until you approve a batch. Here is exactly what it would collect:'
            : 'The rule stops asking and starts acting. Here is exactly what changes:'
      }
      footnote="Pause any time — the rule card's toggle or Pause all."
      confirmLabel={
        enablingToAct ? 'Turn on and run it' : enabling ? 'Turn on and watch' : 'Switch to Active'
      }
      confirmBusyLabel={enabling ? 'Turning on…' : 'Switching…'}
      canConfirm={preview.status === 'ready'}
      pendingAction={pendingAction}
      secondaryAction={
        enablingToAct && onWatchFirst != null
          ? { label: 'Watch first', busyLabel: 'Starting to watch…', onClick: onWatchFirst }
          : undefined
      }
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
        {/* The backlog clause is gated on the COUNT, not on the intent.
            Gating it on `intent === 'enable'` assumed a rule being turned
            on has collected nothing — false for a RE-enabled rule:
            disabling a rule leaves its pending matches in the buffer
            (`listPendingSuggestions` filters on mode + resolution, never
            on `enabled`), and they render on this same screen. Dropping
            the clause there let a user confirm without being told those
            suggestions stay unapproved. */}
        {pendingApproximate || pendingCount > 0 ? (
          <li>
            {pendingApproximate
              ? `Suggestions already collected stay pending below — ${enabling ? 'turning the rule on' : 'activating'} does not approve them. Approve or skip them separately.`
              : `The ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'} already collected ${
                  pendingCount === 1 ? 'stays' : 'stay'
                } pending below — ${enabling ? 'turning the rule on' : 'activating'} does not approve ${
                  pendingCount === 1 ? 'it' : 'them'
                }. Approve or skip ${pendingCount === 1 ? 'it' : 'them'} separately.`}
          </li>
        ) : null}
        {/* Turning a paused rule on resumes it. `{enabled:true, mode}`
            overwrites `paused`, so without this line the commit
            silently undoes a "Pause all" the user had set. */}
        {enabling && rule.mode === 'paused' ? (
          <li>This rule is paused. Turning it on resumes it.</li>
        ) : null}
        {!pendingApproximate && pendingCount === 0 && enablingToAct ? (
          <li>
            Prefer to look before it acts? <strong>Watch first</strong> turns the rule on in
            Observe: it collects matches for your approval and moves nothing until you say so.
          </li>
        ) : null}
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
        <ActivationReport rule={rule} preview={preview} undoWindowDays={undoWindowDays} />
      </div>
    </ConfirmModalFrame>
  );
}

/** Decision-grade report shown only after the server dry-run resolves. */
function ActivationReport({
  rule,
  preview,
  undoWindowDays,
}: {
  rule: AutopilotRuleDto;
  preview: RulePreviewState;
  /** The caller's own undo window — see the prop note on the modal. */
  undoWindowDays: number;
}) {
  if (preview.status !== 'ready') return null;
  const { result } = preview;
  const weeklyCopy =
    result.weeklyVolume.basis === 'observed_7d'
      ? `7-day observed volume: ${result.weeklyVolume.observedMatches.toLocaleString('en-US')} match${
          result.weeklyVolume.observedMatches === 1 ? '' : 'es'
        }.`
      : `Early weekly estimate: about ${result.weeklyVolume.estimatedMatches.toLocaleString('en-US')} match${
          result.weeklyVolume.estimatedMatches === 1 ? '' : 'es'
        }, extrapolated from ${result.weeklyVolume.observedMatches.toLocaleString('en-US')} over ${
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
        {result.protectedWouldMatchCount.toLocaleString('en-US')} additional matching sender
        {result.protectedWouldMatchCount === 1 ? ' is' : 's are'} Protected and will be skipped.
      </div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>{weeklyCopy}</div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>
        Daily safety cap: {result.dailyActionCap.toLocaleString('en-US')} action
        {result.dailyActionCap === 1 ? '' : 's'}. Extra matches wait for a later sweep.
      </div>
      <div style={{ fontSize: 12, color: color.fgSoft, lineHeight: 1.5 }}>
        {recoveryCopy(rule, undoWindowDays)}
      </div>
    </section>
  );
}

function actionableNowCopy(
  rule: AutopilotRuleDto,
  senderCount: number,
  messageCount: number,
): string {
  if (rule.actionKind === 'unsubscribe') {
    return `${senderCount.toLocaleString('en-US')} unsubscribe request${
      senderCount === 1 ? '' : 's'
    } actionable now. Those senders currently account for ${messageCount.toLocaleString('en-US')} inbox message${
      messageCount === 1 ? '' : 's'
    }; unsubscribing does not remove existing mail.`;
  }
  return `${senderCount.toLocaleString('en-US')} sender${senderCount === 1 ? '' : 's'} and ${messageCount.toLocaleString('en-US')} inbox message${messageCount === 1 ? '' : 's'} actionable now.`;
}

function recoveryCopy(rule: AutopilotRuleDto, undoWindowDays: number): string {
  if (rule.actionKind === 'archive') {
    return `Recovery: archive results can be undone from Activity for ${undoWindowDays} days.`;
  }
  if (rule.actionKind === 'later') {
    return `Recovery: Later results return automatically at their scheduled time and can be undone from Activity for ${undoWindowDays} days.`;
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
