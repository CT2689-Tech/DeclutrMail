import { getActionSemantics } from './action-semantics';

export const ACTIVITY_ACTION_LABELS = {
  keep: getActionSemantics('keep').resultLabel,
  archive: getActionSemantics('archive').resultLabel,
  unsubscribe: getActionSemantics('unsubscribe').resultLabel,
  unsubscribe_confirmed: 'Unsubscribe endpoint accepted request',
  unsubscribe_endpoint_accepted: 'Unsubscribe endpoint accepted request',
  unsubscribe_failed: 'Unsubscribe request failed',
  unsubscribe_unconfirmed: 'Unsubscribe result unconfirmed',
  unsubscribe_action_required: 'Email request required',
  unsubscribe_draft_opened: 'Gmail draft opened',
  unsubscribe_user_marked_sent: 'Marked unsubscribe email sent',
  unsubscribe_unavailable: 'No unsubscribe channel available',
  later: getActionSemantics('later').resultLabel,
  delete: getActionSemantics('delete').resultLabel,
  'followup-dismiss': 'Followup resolved',
  marked_protected: 'Protected',
  unmarked_protected: 'Unprotected',
} as const;

export type ActivityPresentationAction = keyof typeof ACTIVITY_ACTION_LABELS;
export type ActivityPresentationSource = 'triage' | 'manual' | 'autopilot' | 'screener';
export type ActivityPresentationUndoKind = 'available' | 'expired' | 'executed' | 'unavailable';

export type ActivityExecutionPresentation =
  | { kind: 'in_progress'; status: 'queued' | 'executing'; isRecovery: boolean }
  | { kind: 'failed'; resolution: 'review' | 'support' };

export function activityActionLabel(
  action: ActivityPresentationAction,
  execution: ActivityExecutionPresentation | null,
): string {
  if (!execution) return ACTIVITY_ACTION_LABELS[action];
  if (action !== 'archive' && action !== 'later' && action !== 'delete') {
    return ACTIVITY_ACTION_LABELS[action];
  }
  if (execution.kind === 'failed') {
    if (action === 'archive') return 'Archive failed';
    if (action === 'later') return 'Later failed';
    return 'Delete failed';
  }
  if (action === 'archive') return 'Archiving…';
  if (action === 'later') return 'Moving to Later…';
  return 'Deleting…';
}

export function activityExecutionLabel(execution: ActivityExecutionPresentation | null): string {
  if (!execution) return 'Completed';
  if (execution.kind === 'in_progress') {
    const prefix = execution.isRecovery ? 'Recovery ' : '';
    return `${prefix}${execution.status === 'queued' ? 'queued' : 'in progress'}`;
  }
  return execution.resolution === 'review'
    ? 'Failed · review available'
    : 'Failed · support required';
}

const ACTIVITY_SOURCE_LABELS: Record<ActivityPresentationSource, string> = {
  triage: 'Triage',
  manual: 'Manual',
  autopilot: 'Autopilot',
  screener: 'Screener',
};

export function activitySourceLabel(source: ActivityPresentationSource): string {
  return ACTIVITY_SOURCE_LABELS[source];
}

const ACTIVITY_UNDO_LABELS: Record<ActivityPresentationUndoKind, string> = {
  available: 'Available',
  expired: 'Expired',
  executed: 'Already undone',
  unavailable: 'Not available',
};

export function activityUndoLabel(kind: ActivityPresentationUndoKind): string {
  return ACTIVITY_UNDO_LABELS[kind];
}
