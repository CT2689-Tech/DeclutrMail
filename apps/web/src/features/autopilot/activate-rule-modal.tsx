'use client';

import { useState } from 'react';
import { SheetSegmented, tokens, type SheetFactItem } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotRuleDto, AutopilotRulePreviewResultDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame, ruleEffectFacts } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';
import { RulePreviewHero, RulePreviewSample } from './rule-preview-panel';
import type { RulePreviewState } from './types';

const { color, space, text } = tokens;

type ActivateRuleModalProps = {
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
  /** The active mailbox to show in the note; omitted renders nothing. */
  mailboxEmail?: string | undefined;
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
};

/**
 * Mounted by the screen for its whole life with `rule = null` while
 * closed. The sheet itself mounts per opening, so the Watch first / Act
 * now choice never carries over from the last rule the user looked at.
 */
export function ActivateRuleModal({ rule, ...rest }: ActivateRuleModalProps) {
  if (rule == null) return null;
  return <ActivateRuleSheet key={rule.id} rule={rule} {...rest} />;
}

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
function ActivateRuleSheet({
  rule,
  intent = 'activate',
  canRunUnattended = true,
  pendingAction,
  mailboxEmail,
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
}: ActivateRuleModalProps & { rule: AutopilotRuleDto }) {
  // Which way an entitled enable commits. "Act now" is the default
  // because it is what the primary button did before the two commits
  // became one choice; the requests themselves are unchanged.
  const [choice, setChoice] = useState<'act' | 'watch'>('act');
  const name = presetDisplayName(rule.presetKey, rule.name);

  const enabling = intent === 'enable';
  // Turning a rule on without the unattended capability can only mean
  // Observe, so the choice disappears rather than offering a commit
  // that would 402.
  const enablingToAct = enabling && canRunUnattended;
  const offersChoice = enablingToAct && onWatchFirst != null;
  const watching = offersChoice && choice === 'watch';
  // Does the commit leave the rule in `active`? Both the day-7 promote
  // (`intent='activate'`) and an entitled "Act now" do; an enable
  // without the capability, and "Watch first", do not. The backlog
  // sentence reads differently either way, because the server supersedes
  // this rule's pending Observe suggestions only on the transition into
  // `active`.
  const commitsActive = (!enabling || enablingToAct) && !watching;
  const presentation = rulePresentation(rule);
  const protectedCount = preview.status === 'ready' ? preview.result.protectedWouldMatchCount : 0;

  return (
    <ConfirmModalFrame
      title={enabling ? `Turn on ${name}?` : `Switch ${name} to Active?`}
      subtitle={matchEffectCopy(presentation)}
      note={`${
        protectedCount > 0
          ? `${protectedCount.toLocaleString('en-US')} Protected sender${
              protectedCount === 1 ? ' is' : 's are'
            } skipped.`
          : 'Protected senders are skipped.'
      } ${undoNote(rule, undoWindowDays)}`}
      confirmLabel={watching ? 'Watch first' : enabling ? 'Turn on' : 'Switch to Active'}
      confirmBusyLabel={
        pendingAction === 'secondary' || (pendingAction == null && watching)
          ? 'Starting to watch…'
          : enabling
            ? 'Turning on…'
            : 'Switching…'
      }
      // D226 — every commit waits for the dry-run, "Watch first" included:
      // it moves no mail, but it still commits a mode.
      canConfirm={preview.status === 'ready'}
      mailboxEmail={mailboxEmail}
      isBusy={isActivating}
      error={error}
      onCancel={onCancel}
      // ⌘⏎ and the button share this, so the shortcut can only ever run
      // the commit the user has selected and can see on the button.
      onConfirm={watching && onWatchFirst != null ? onWatchFirst : onConfirm}
      facts={[
        ...(preview.status === 'ready' ? activationFacts(rule, preview.result) : []),
        ...ruleEffectFacts(presentation.primary),
        // Gated on the COUNT, not on the intent. A RE-enabled rule keeps
        // its pending matches in the buffer (`listPendingSuggestions`
        // filters on mode + resolution, never on `enabled`), and they
        // render on this same screen.
        //
        // Two different truths, and saying the wrong one is not a wording
        // slip. Going ACTIVE, the server clears this rule's pending
        // suggestions (`dismiss_reason='superseded'`) in the same
        // transaction as the mode change, because the sweep re-matches
        // those senders and acts on them. Going to OBSERVE, nothing is
        // superseded and they really do stay pending.
        ...(pendingApproximate || pendingCount > 0
          ? [
              {
                label: 'Already collected',
                value: backlogCopy(commitsActive, pendingCount, pendingApproximate),
              },
            ]
          : []),
        // Turning a paused rule on resumes it. `{enabled:true, mode}`
        // overwrites `paused`, so without this the commit silently undoes
        // a "Pause all" the user had set.
        ...(enabling && rule.mode === 'paused'
          ? [{ label: 'Paused', value: 'Turning it on resumes it' }]
          : []),
        { label: 'Pause', value: 'Any time, from the rule’s toggle or Pause all' },
      ]}
      trailing={
        preview.status === 'ready' ? (
          <RulePreviewSample ruleName={name} result={preview.result} />
        ) : undefined
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
        {/* D226 — what the FIRST active sweep would act on right now (same
            signal materializer as the apply worker). */}
        <RulePreviewHero state={preview} onRetry={onRetryPreview} />
        {offersChoice ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: space[2] }}>
            <SheetSegmented
              label="How this rule runs"
              value={choice}
              onChange={setChoice}
              options={[
                { value: 'watch', label: 'Watch first', disabled: isActivating },
                { value: 'act', label: 'Act now', disabled: isActivating },
              ]}
            />
            <span style={{ fontSize: text.sm, lineHeight: 1.45, color: color.fgMuted }}>
              {watching
                ? 'Nothing moves until you approve each match.'
                : 'Acts on matching email now and as it arrives.'}
            </span>
          </div>
        ) : (
          <span style={{ fontSize: text.sm, lineHeight: 1.45, color: color.fgMuted }}>
            {enabling
              ? 'Nothing moves until you approve each match.'
              : 'Stops asking and starts acting.'}
          </span>
        )}
      </div>
    </ConfirmModalFrame>
  );
}

function backlogCopy(commitsActive: boolean, pendingCount: number, approximate: boolean): string {
  const one = pendingCount === 1;
  const n = `${pendingCount} suggestion${one ? '' : 's'}`;
  if (commitsActive) {
    return approximate
      ? 'Covered by this; they clear from pending'
      : `${n} covered by this; ${one ? 'it clears' : 'they clear'} from pending`;
  }
  return approximate
    ? 'Stay pending; approve or skip them separately'
    : `${n} ${one ? 'stays' : 'stay'} pending; approve or skip ${one ? 'it' : 'them'} separately`;
}

const fmt = (value: number) => value.toLocaleString('en-US');
const plural = (count: number, word: string, suffix = 's') =>
  `${fmt(count)} ${word}${count === 1 ? '' : suffix}`;

/** Decision-grade report as Details facts, only after the dry-run resolves. */
function activationFacts(
  rule: AutopilotRuleDto,
  result: AutopilotRulePreviewResultDto,
): SheetFactItem[] {
  const weekly =
    result.weeklyVolume.basis === 'observed_7d'
      ? { label: 'Last 7 days', value: plural(result.weeklyVolume.observedMatches, 'match', 'es') }
      : {
          label: 'Weekly estimate',
          value: `About ${plural(result.weeklyVolume.estimatedMatches, 'match', 'es')}, from ${fmt(
            result.weeklyVolume.observedMatches,
          )} over ${plural(result.weeklyVolume.observedDays, 'day')}`,
        };
  return [
    {
      label: 'Matches',
      value: `${fmt(result.wouldMatchCount)} of ${plural(result.evaluatedSenders, 'sender')}`,
    },
    {
      // "Actionable" = the rule has something to do for that sender now.
      label: 'Actionable now',
      value:
        rule.actionKind === 'unsubscribe'
          ? `${plural(result.actionableSenderCount, 'request')} · ${plural(
              result.actionableMessageCount,
              'inbox email',
            )}`
          : `${plural(result.actionableSenderCount, 'sender')} · ${plural(
              result.actionableMessageCount,
              'inbox email',
            )}`,
    },
    weekly,
    {
      label: 'Daily cap',
      value: `${plural(result.dailyActionCap, 'action')}, the rest wait for the next check`,
    },
  ];
}

/**
 * The sheet's one-line undo posture — the whole recovery story: Details
 * adds only Later's scheduled return (`ruleEffectFacts`).
 */
function undoNote(rule: AutopilotRuleDto, undoWindowDays: number): string {
  return rule.actionKind === 'unsubscribe'
    ? 'Unsubscribe requests can’t be undone.'
    : `Undo from Activity for ${undoWindowDays} days.`;
}

type RulePresentation = ReturnType<typeof rulePresentation>;

/**
 * What the rule does to ONE match, in one sentence: the unsubscribe
 * request for an Unsubscribe rule (its existing-mail sentence only says
 * nothing moves), where the email goes for Archive and Later.
 */
function matchEffectCopy(presentation: RulePresentation): string {
  const { primary } = presentation;
  return primary.verb === 'unsubscribe' ? primary.futureMail.summary : primary.currentMail.summary;
}

/** Verb-honest presentation of the rule's action (D227; D230 mailto stays manual). */
function rulePresentation(rule: AutopilotRuleDto) {
  return buildActionPresentation({
    verb: rule.actionKind,
    liveCount: null,
    planUndoDeadline: null,
    wakeAt: rule.actionKind === 'later' ? defaultLaterWakeAtIso() : null,
    unsubscribeChannel: 'varies',
    // Absolute times render in the reader's own clock: every one of
    // these surfaces is opened by a click, never server-rendered.
    timeZone: 'viewer',
  });
}
