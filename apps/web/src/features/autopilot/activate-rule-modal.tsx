'use client';

import { tokens } from '@declutrmail/shared';
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
            ? 'Suggestions already collected stay pending below — activating does not approve them. Approve or dismiss them separately.'
            : `The ${pendingCount} suggestion${pendingCount === 1 ? '' : 's'} already collected ${
                pendingCount === 1 ? 'stays' : 'stay'
              } pending below — activating does not approve ${
                pendingCount === 1 ? 'it' : 'them'
              }. Approve or dismiss ${pendingCount === 1 ? 'it' : 'them'} separately.`}
        </li>
        <li>Senders you mark Protected or VIP are always skipped.</li>
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
      </div>
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
      return "New matches have their current inbox mail moved to the DeclutrMail/Later label and scheduled to return in one week. Future mail is unchanged; change the wake time on Later or undo during your plan's Activity window.";
  }
}
