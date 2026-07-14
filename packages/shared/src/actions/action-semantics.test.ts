import { describe, expect, it } from 'vitest';

import { ACTION_VERBS } from '../contracts/verb-constants';
import {
  ACTION_SEMANTICS,
  actionHasRecovery,
  buildActionPresentation,
  buildActionReceiptResult,
  staticActionPreviewCopy,
} from './action-semantics';
import type { ActionStatusSnapshot } from './action-semantics';

describe('D245 action semantics', () => {
  it('defines every registered action exactly once', () => {
    expect(Object.keys(ACTION_SEMANTICS).sort()).toEqual([...ACTION_VERBS].sort());
  });

  it('makes Later a timed current-mail move and leaves future mail unchanged', () => {
    const later = ACTION_SEMANTICS.later;
    expect(later.currentMail).toMatchObject({
      scope: 'matching-current-inbox',
      destination: 'declutrmail-later',
    });
    expect(later.futureMail.effect).toBe('unchanged');
    expect(later.schedule).toEqual({
      kind: 'required',
      parameter: 'wakeAt',
      validation: 'future-iso-datetime',
      summary: 'Choose when the email returns to Inbox.',
    });
  });

  it('marks delivered unsubscribe as irreversible', () => {
    expect(ACTION_SEMANTICS.unsubscribe.activityUndo.kind).toBe('none');
    expect(ACTION_SEMANTICS.unsubscribe.providerRecovery.kind).toBe('none');
    expect(ACTION_SEMANTICS.unsubscribe.finality.kind).toBe('delivered-request-cannot-be-recalled');
    expect(actionHasRecovery('unsubscribe')).toBe(false);
  });

  it('keeps plan Undo and Gmail Trash recovery separate for Delete', () => {
    const deletion = ACTION_SEMANTICS.delete;
    expect(deletion.activityUndo.kind).toBe('plan-window');
    expect(deletion.providerRecovery).toMatchObject({
      kind: 'gmail-trash',
      approximateDays: 30,
    });
    expect(staticActionPreviewCopy('delete')).toContain('DeclutrMail Undo');
    expect(staticActionPreviewCopy('delete')).toContain('Gmail Trash recovery is separate');
  });

  it('states current scope and future behavior for every canonical mutation', () => {
    for (const verb of ['archive', 'later', 'unsubscribe', 'delete'] as const) {
      const copy = staticActionPreviewCopy(verb);
      expect(copy).toContain(ACTION_SEMANTICS[verb].currentMail.summary);
      expect(copy).toContain(ACTION_SEMANTICS[verb].futureMail.summary);
    }
  });

  it('builds one structured, human-readable preview for a timed composite', () => {
    const presentation = buildActionPresentation({
      verb: 'later',
      liveCount: 4,
      planUndoDeadline: '2026-07-15T17:30:00.000Z',
      wakeAt: '2026-07-21T16:00:00.000Z',
      unsubscribeChannel: null,
      secondaryAction: { verb: 'delete', liveCount: 2 },
    });

    expect(presentation.totalLiveCount).toBe(6);
    expect(presentation.primary.schedule).toEqual({
      kind: 'scheduled',
      wakeAt: '2026-07-21T16:00:00.000Z',
      summary: 'Returns to Inbox Jul 21, 2026 at 4:00 PM UTC.',
    });
    expect(presentation.primary.activityUndo).toMatchObject({
      kind: 'plan-window',
      deadline: '2026-07-15T17:30:00.000Z',
    });
    expect(presentation.secondary?.providerRecovery.kind).toBe('gmail-trash');
    expect(presentation.previewCopy).toContain('Also: 2 matching emails.');
    expect(presentation.previewCopy).not.toContain('2026-07-21T16:00:00.000Z');
  });

  it('uses action scope for counts and omits unavailable counts', () => {
    const unsubscribe = buildActionPresentation({
      verb: 'unsubscribe',
      liveCount: 27,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: 'mailto',
    });
    expect(unsubscribe.previewCopy).toContain('Existing email stays where it is');
    expect(unsubscribe.previewCopy).toContain('prefilled Gmail draft; you send it');
    expect(unsubscribe.previewCopy).not.toContain('27 matching');

    const unknownCount = buildActionPresentation({
      verb: 'archive',
      liveCount: null,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: null,
    });
    expect(unknownCount.totalLiveCount).toBeNull();
    expect(unknownCount.primary.facts.some((fact) => fact.includes('matching email'))).toBe(false);
  });

  it('rejects invented counts and invalid presentation dates', () => {
    expect(() =>
      buildActionPresentation({
        verb: 'archive',
        liveCount: -1,
        planUndoDeadline: null,
        wakeAt: null,
        unsubscribeChannel: null,
      }),
    ).toThrow(RangeError);
    expect(() =>
      buildActionPresentation({
        verb: 'later',
        liveCount: 1,
        planUndoDeadline: null,
        wakeAt: 'not-a-date',
        unsubscribeChannel: null,
      }),
    ).toThrow(RangeError);
  });

  it('discriminates applied, partial, no-op, and failed receipts', () => {
    const snapshot = actionSnapshot();
    expect(buildActionReceiptResult(snapshot).outcome).toBe('applied');
    expect(
      buildActionReceiptResult({ ...snapshot, requestedCount: 4, affectedCount: 2 }).outcome,
    ).toBe('partial');
    expect(buildActionReceiptResult({ ...snapshot, affectedCount: 0 }).outcome).toBe('no-op');

    const failure = buildActionReceiptResult({
      ...snapshot,
      status: 'failed',
      affectedCount: 1,
      errorCode: 'PROVIDER_REFUSED',
    });
    expect(failure).toMatchObject({
      state: 'failed',
      outcome: 'failure',
      requestedCount: 2,
      affectedCount: 1,
      errorCode: 'PROVIDER_REFUSED',
    });
  });

  it('keeps Activity Undo, provider recovery, wake, and finality distinct', () => {
    const receipt = buildActionReceiptResult(
      {
        ...actionSnapshot(),
        verb: 'delete',
        wakeAt: '2026-07-21T16:00:00.000Z',
        undoExpiresAt: '2026-07-20T00:00:00.000Z',
      },
      new Date('2026-07-19T00:00:00.000Z'),
    );

    expect(receipt.wake).toEqual({ kind: 'scheduled', at: '2026-07-21T16:00:00.000Z' });
    expect(receipt.activityUndo).toEqual({
      state: 'available',
      token: 'undo-1',
      deadline: '2026-07-20T00:00:00.000Z',
    });
    expect(receipt.providerRecovery.kind).toBe('gmail-trash');
    expect(receipt.finality.kind).toBe('provider-permanent-deletion');
  });
});

function actionSnapshot(): ActionStatusSnapshot {
  return {
    actionId: 'action-1',
    verb: 'archive',
    direction: 'forward',
    status: 'done',
    requestedCount: 2,
    affectedCount: 2,
    wakeAt: null,
    undoToken: 'undo-1',
    undoExpiresAt: '2026-07-20T00:00:00.000Z',
    undoExecutedAt: null,
    undoRevertedAt: null,
    errorCode: null,
  };
}
