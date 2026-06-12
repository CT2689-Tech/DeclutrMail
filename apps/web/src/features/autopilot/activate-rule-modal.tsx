'use client';

import { tokens } from '@declutrmail/shared';
import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';

const { color } = tokens;

/**
 * D226 mandatory preview for switching a rule Observe → Active — the
 * one mutation on this screen that STARTS automated mail actions, so
 * the preview spells out exactly what changes:
 *
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
  isActivating,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto | null;
  pendingCount: number;
  /** True when the pending buffer hit the BE's 50-row cap (count is a floor). */
  pendingApproximate: boolean;
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
      canConfirm
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
            ? 'Suggestions already collected stay pending below — activating does not approve them. Approve or dismiss them separately.'
            : `The ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'} already collected ${
                pendingCount === 1 ? 'stays' : 'stay'
              } pending below — activating does not approve ${
                pendingCount === 1 ? 'it' : 'them'
              }. Approve or dismiss ${pendingCount === 1 ? 'it' : 'them'} separately.`}
        </li>
        <li>Senders you mark Protected or VIP are always skipped.</li>
      </ul>
    </ConfirmModalFrame>
  );
}

/** Verb-honest description of Active mode (D227 canonical verbs; D230 mailto stays manual). */
function goingForwardCopy(rule: AutopilotRuleDto): string {
  switch (rule.actionKind) {
    case 'archive':
      return 'New matches have their inbox mail archived automatically. Nothing is deleted, and each archive can be undone from the Activity feed.';
    case 'unsubscribe':
      return 'New matches are unsubscribed automatically where the sender supports one-click unsubscribe. Senders that only take unsubscribes by email are queued for you to send manually — DeclutrMail never auto-sends from a no-reply address. Unsubscribe requests cannot be recalled once sent.';
    case 'later':
      return 'New matches have their inbox mail moved to the DeclutrMail/Later label automatically — out of your way, one click away, undoable from the Activity feed.';
  }
}
