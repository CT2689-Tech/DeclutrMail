'use client';

import { tokens, type SheetFactItem } from '@declutrmail/shared';
import { buildActionPresentation, defaultLaterWakeAtIso } from '@declutrmail/shared/actions';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame, ruleEffectFacts } from './confirm-modal-frame';
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
        <ul
          aria-label="Senders in these suggestions"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: `${space[3]}px 0 0`,
            display: 'flex',
            flexDirection: 'column',
            gap: space[2],
          }}
        >
          {matches.map((m) => {
            const identity = resolveSenderIdentity(m);
            return (
              <li key={m.id} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
      }
      facts={approveFacts(rule, shown, approxTotal, coversMoreThanShown)}
    />
  );
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

/**
 * What approving does beyond the title (the scope) and the subtitle (the
 * effect), as Details facts (D227 canonical verbs).
 */
function approveFacts(
  rule: AutopilotRuleDto,
  shown: number,
  approxTotal: number | null,
  coversMoreThanShown: boolean,
): SheetFactItem[] {
  const { primary, secondary } = autopilotPresentation(rule);
  return [
    // "Approve all" covers rows beyond the capped page: the list above
    // is only the latest page, never presented as the total.
    ...(coversMoreThanShown
      ? [
          {
            label: 'Showing',
            value:
              approxTotal != null
                ? `${shown} of ~${approxTotal}`
                : `${shown}, approving covers all pending`,
          },
        ]
      : []),
    ...ruleEffectFacts(primary),
    // A secondary action has no note slot, so it keeps its full copy.
    ...(secondary ? [{ label: 'Also', value: secondary.previewCopy }] : []),
    ...(primary.providerRecovery.kind === 'gmail-trash'
      ? [
          {
            label: 'Gmail Trash',
            value: `Kept up to ${primary.providerRecovery.approximateDays} days, then deleted for good`,
          },
        ]
      : []),
  ];
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
