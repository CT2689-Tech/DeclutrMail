import { describe, expect, it } from 'vitest';

import { ACTION_VERBS } from '../contracts/verb-constants';
import { ACTION_SEMANTICS, actionHasRecovery, staticActionPreviewCopy } from './action-semantics';

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
});
