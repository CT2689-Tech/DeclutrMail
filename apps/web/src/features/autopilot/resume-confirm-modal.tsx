'use client';

import type { AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';
import type { RulePreviewState } from './types';

/**
 * D226 preview for Resume (paused → Observe, per `AutopilotScreen`'s
 * `onResume`).
 *
 * Founder decision 2026-09-29 (a): approving a suggestion is blocked
 * while its rule is paused, but an OLDER action can still be sitting
 * `approved, intent_applied=false` from back when the rule was Active
 * — the very next sweep after resuming runs it, irreversible
 * Unsubscribe requests included. This sheet is what stops that from
 * happening unseen. It always renders, even when nothing is waiting —
 * same "every mutation gets a preview" precedent as `PauseConfirmModal`
 * for a mutation that is otherwise low-stakes on its own.
 * docs/log/founder-followups/2026-09-27-autopilot-approvals-on-paused-rules.md
 */
export function ResumeConfirmModal({
  rule,
  preview,
  mailboxEmail,
  isResuming,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto | null;
  /** First-sweep dry-run state — fired by the opener when the modal opens. */
  preview: RulePreviewState;
  mailboxEmail?: string | undefined;
  isResuming: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (rule == null) return null;
  const name = presetDisplayName(rule.presetKey, rule.name);

  const note =
    preview.status === 'ready'
      ? preview.result.waitingApprovedCount > 0
        ? `${preview.result.waitingApprovedCount} approval${
            preview.result.waitingApprovedCount === 1 ? '' : 's'
          } from before it paused will run on the next check.`
        : 'Nothing is waiting to run.'
      : preview.status === 'loading'
        ? 'Checking for approvals waiting to run…'
        : undefined;

  return (
    <ConfirmModalFrame
      title={`Resume ${name}?`}
      subtitle="Starts watching for matches again."
      note={note}
      confirmLabel="Resume"
      confirmBusyLabel="Resuming…"
      canConfirm={preview.status === 'ready'}
      mailboxEmail={mailboxEmail}
      isBusy={isResuming}
      error={error ?? (preview.status === 'error' ? preview.message : null)}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
