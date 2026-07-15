import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_ACTION_LABELS,
  activityActionLabel,
  activityExecutionLabel,
  activitySourceLabel,
  activityUndoLabel,
} from './activity-record-copy';

describe('D245 Activity record copy', () => {
  it('keeps one complete Activity action vocabulary', () => {
    expect(Object.keys(ACTIVITY_ACTION_LABELS).sort()).toEqual(
      [
        'archive',
        'delete',
        'followup-dismiss',
        'keep',
        'later',
        'marked_protected',
        'unmarked_protected',
        'unsubscribe',
        'unsubscribe_action_required',
        'unsubscribe_confirmed',
        'unsubscribe_draft_opened',
        'unsubscribe_endpoint_accepted',
        'unsubscribe_failed',
        'unsubscribe_unavailable',
        'unsubscribe_unconfirmed',
        'unsubscribe_user_marked_sent',
      ].sort(),
    );
  });

  it('describes outcomes and unresolved execution without exposing status codes', () => {
    expect(activityActionLabel('delete', null)).toBe('Moved to Gmail Trash');
    expect(
      activityActionLabel('archive', {
        kind: 'in_progress',
        status: 'queued',
        isRecovery: false,
      }),
    ).toBe('Archiving…');
    expect(activityExecutionLabel({ kind: 'failed', resolution: 'support' })).toBe(
      'Failed · support required',
    );
  });

  it('provides human labels for source and Undo state', () => {
    expect(activitySourceLabel('autopilot')).toBe('Autopilot');
    expect(activityUndoLabel('available')).toBe('Available');
    expect(activityUndoLabel('unavailable')).toBe('Not available');
  });
});
