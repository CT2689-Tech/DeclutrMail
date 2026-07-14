'use client';

import { tokens } from '@declutrmail/shared';
import type { AutopilotMatchDto, AutopilotRuleDto } from '@/lib/api/autopilot';
import { ConfirmModalFrame } from './confirm-modal-frame';
import { presetDisplayName } from './preset-labels';

const { color, font } = tokens;

/**
 * D226 mandatory preview for the D104 approve flow — both "Approve
 * all" (every pending suggestion for one rule) and "Approve selected"
 * (the checked subset). Approving flips the matches to `approved` and
 * enqueues the action sweep, so mail WILL move: the preview enumerates
 * the exact senders and states the verb-true consequence before the
 * mutation fires.
 *
 * Copy honesty (D230, D58): archive/Later actions are undoable from
 * Activity; one-click unsubscribes cannot be recalled, and mailto
 * unsubscribes are queued for manual send — never auto-sent.
 */
export function ApproveConfirmModal({
  rule,
  matches,
  isApproving,
  error,
  onCancel,
  onConfirm,
}: {
  rule: AutopilotRuleDto;
  /** The pending matches this approval covers (all, or the selection). */
  matches: AutopilotMatchDto[];
  isApproving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = presetDisplayName(rule.presetKey, rule.name);
  const n = matches.length;

  return (
    <ConfirmModalFrame
      open
      titleId="dm-approve-title"
      title={`Approve ${n} suggestion${n === 1 ? '' : 's'} from "${name}"`}
      lead={approveLead(rule, n)}
      footnote={approveFootnote(rule)}
      confirmLabel={`Approve ${n === 1 ? 'suggestion' : `${n} suggestions`}`}
      confirmBusyLabel="Approving…"
      canConfirm={n > 0}
      isBusy={isApproving}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
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
function approveLead(rule: AutopilotRuleDto, n: number): string {
  const senders = n === 1 ? 'this sender' : `these ${n} senders`;
  switch (rule.actionKind) {
    case 'archive':
      return `DeclutrMail archives the inbox mail from ${senders}. Nothing is deleted.`;
    case 'unsubscribe':
      return `DeclutrMail unsubscribes from ${senders} — one-click where the sender supports it; senders that only take unsubscribes by email are queued for you to send manually.`;
    case 'later':
      return `DeclutrMail moves current inbox mail from ${senders} into the DeclutrMail/Later label and schedules it to return in one week. Future mail is unchanged.`;
  }
}

/** Undo posture, verb-honest (D58 — unsubscribe requests are one-way). */
function approveFootnote(rule: AutopilotRuleDto): string {
  switch (rule.actionKind) {
    case 'archive':
    case 'later':
      return 'Undo each action from the Activity feed.';
    case 'unsubscribe':
      return "Sent unsubscribe requests can't be recalled.";
  }
}
