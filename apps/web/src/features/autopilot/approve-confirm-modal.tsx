'use client';

import { tokens } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';
import { resolveSenderIdentity } from './sender-label';

const { color, space, text } = tokens;

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
  mailboxEmail,
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
  /** The active mailbox to show in the note; omitted renders nothing. */
  mailboxEmail?: string | undefined;
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
      ? `Approve all ~${approxTotal} suggestions?`
      : 'Approve all pending suggestions?'
    : `Approve ${shown} suggestion${shown === 1 ? '' : 's'}?`;
  const confirmLabel = coversMoreThanShown
    ? approxTotal != null
      ? `Approve all ~${approxTotal}`
      : 'Approve all'
    : `Approve ${shown}`;
  const { primary } = autopilotPresentation(rule);

  return (
    <ConfirmModalFrame
      title={title}
      subtitle={`From ${name}. ${
        primary.verb === 'unsubscribe' ? primary.futureMail.summary : primary.currentMail.summary
      }`}
      note={primary.activityUndo.summary}
      confirmLabel={confirmLabel}
      confirmBusyLabel="Approving…"
      canConfirm={shown > 0}
      mailboxEmail={mailboxEmail}
      isBusy={isApproving}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
      details={
        <>
          <span>{approveLead(rule, shown, approxTotal, coversMoreThanShown)}</span>
          {primary.providerRecovery.kind === 'none' ? null : (
            <span>{primary.providerRecovery.summary}</span>
          )}
          {coversMoreThanShown && (
            <span>
              {approxTotal != null
                ? `Showing ${shown} of ~${approxTotal}.`
                : `Showing ${shown} — approving covers all pending.`}
            </span>
          )}
          <ul
            aria-label="Senders in these suggestions"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {matches.map((m, i) => {
              const identity = resolveSenderIdentity(m);
              return (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: `${space[2]}px 0`,
                    borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{ ...ellipsis, fontSize: text.base, fontWeight: 600, color: color.fg }}
                  >
                    {identity.label}
                  </span>
                  {identity.source === 'name' && m.senderEmail != null && (
                    <span style={{ ...ellipsis, fontSize: text.xs, color: color.fgMuted }}>
                      {m.senderEmail}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      }
    />
  );
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

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
  // The sheet's note owns the primary action's undo fact, so the lead
  // takes `effectCopy` — `previewCopy` carries those same sentences and
  // printed "cannot be undone" twice. A secondary action has no note
  // slot, so it keeps its full `previewCopy`.
  const { primary, secondary } = presentation;
  const effect = secondary
    ? `${primary.effectCopy} Also: ${secondary.previewCopy}`
    : primary.effectCopy;
  return `${scope}: ${effect}`;
}

function autopilotPresentation(rule: AutopilotRuleDto) {
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
