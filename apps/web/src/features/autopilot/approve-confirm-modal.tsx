'use client';

import { tokens } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * D226 mandatory preview for the D104 approve flow — both "Approve
 * all" (every pending suggestion for one rule) and "Approve selected"
 * (the checked subset). Approving flips the matches to `approved` and
 * enqueues the action sweep. This preview enumerates the sender scope;
 * Gmail is re-checked at execution, so it never claims a frozen message
 * count.
 *
 * Copy honesty (D230, D58): archive/Later actions are undoable from
 * Activity; one-click unsubscribes cannot be recalled, and mailto
 * unsubscribes are queued for manual send — never auto-sent.
 *
 * Scope honesty (D226): "Approve all" is an UNCAPPED server-side update
 * of every pending row for the rule, while `matches` is at most the
 * BE's 50-row page. When the buffer is capped, the title/lead/confirm
 * state the real uncapped scope and the chip list is qualified as
 * "the latest N" — never a page count presented as the total.
 */
export function ApproveConfirmModal({
  rule,
  matches,
  kind,
  pendingTotal,
  pendingApproximate,
  isApproving,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto;
  /** The pending matches shown in the preview (the buffered page, or the selection). */
  matches: AutopilotMatchDto[];
  /** 'all' approves EVERY pending row server-side; 'selected' only `matches`. */
  kind: 'all' | 'selected';
  /**
   * Uncapped pending total for the rule (`observeDigest.pendingTotal`);
   * null when the server digest is unavailable. Consulted only for
   * kind='all' when the buffer is capped.
   */
  pendingTotal: number | null;
  /** True when the pending buffer hit the BE's 50-row page cap. */
  pendingApproximate: boolean;
  isApproving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = presetDisplayName(rule.presetKey, rule.name);
  const shown = matches.length;
  // "Approve all" covers rows beyond the capped page — the copy below
  // must describe the real scope, not the page (D226 honest preview).
  const coversMoreThanShown = kind === 'all' && pendingApproximate;
  const approxTotal =
    coversMoreThanShown && pendingTotal != null ? Math.max(pendingTotal, shown) : null;

  const title = coversMoreThanShown
    ? approxTotal != null
      ? `Approve ALL ~${approxTotal} pending suggestions from "${name}"`
      : `Approve ALL pending suggestions from "${name}"`
    : `Approve ${shown} suggestion${shown === 1 ? '' : 's'} from "${name}"`;
  const confirmLabel = coversMoreThanShown
    ? approxTotal != null
      ? `Approve all ~${approxTotal} suggestions`
      : 'Approve all pending suggestions'
    : `Approve ${shown === 1 ? 'suggestion' : `${shown} suggestions`}`;

  return (
    <ConfirmModalFrame
      open
      titleId="dm-approve-title"
      title={title}
      lead={approveLead(rule, shown, approxTotal, coversMoreThanShown)}
      footnote={approveFootnote(rule)}
      confirmLabel={confirmLabel}
      confirmBusyLabel="Approving…"
      canConfirm={shown > 0}
      isBusy={isApproving}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {coversMoreThanShown && (
        <p style={{ margin: '0 0 8px', fontSize: 11.5, lineHeight: 1.5, color: color.fgMuted }}>
          Showing the latest {shown} of {approxTotal != null ? `~${approxTotal}` : 'all'} pending
          suggestions — approving covers every pending suggestion for this rule.
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {matches.map((m) => (
          <span
            key={m.id}
            style={{
              fontFamily: font.mono,
              fontSize: 11,
              color: color.fgSoft,
              background: color.paper,
              border: `1px solid ${color.line}`,
              borderRadius: 6,
              padding: '3px 8px',
              maxWidth: 240,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={m.senderEmail ?? m.senderName ?? 'Sender details still syncing'}
          >
            {m.senderName ?? 'Sender details still syncing'}
          </span>
        ))}
      </div>
    </ConfirmModalFrame>
  );
}

/** Verb-true "what happens on approve" lead (D227 canonical verbs). */
function approveLead(
  rule: AutopilotRuleDto,
  shown: number,
  approxTotal: number | null,
  coversMoreThanShown: boolean,
): string {
  const scope = coversMoreThanShown
    ? approxTotal != null
      ? `All ~${approxTotal} pending suggestions`
      : 'All pending suggestions'
    : shown === 1
      ? 'This suggestion'
      : `These ${shown} suggestions`;
  const presentation = autopilotPresentation(rule);
  return `${scope}: ${presentation.previewCopy}`;
}

/** Undo posture, verb-honest (D58 — unsubscribe requests are one-way). */
function approveFootnote(rule: AutopilotRuleDto): string {
  const action = autopilotPresentation(rule).primary;
  return [
    action.activityUndo.summary,
    ...(action.providerRecovery.kind === 'none' ? [] : [action.providerRecovery.summary]),
    ...(action.finality.kind === 'reversible-or-changeable' ? [] : [action.finality.summary]),
  ].join(' ');
}

function autopilotPresentation(rule: AutopilotRuleDto) {
  return buildActionPresentation({
    verb: rule.actionKind,
    liveCount: null,
    planUndoDeadline: null,
    wakeAt: rule.actionKind === 'later' ? defaultLaterWakeAtIso() : null,
    unsubscribeChannel: rule.actionKind === 'unsubscribe' ? null : null,
  });
}
