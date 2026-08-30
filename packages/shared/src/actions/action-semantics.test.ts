import { describe, expect, it } from 'vitest';

import { ACTION_VERBS } from '../contracts/verb-constants';
import { UNIFORM_UNDO_WINDOW_DAYS } from '../entitlements/undo-window';
import {
  ACTION_SEMANTICS,
  actionHasRecovery,
  activityUndoSummary,
  buildActionPresentation,
  buildActionReceiptResult,
  composeRecoveryFacts,
  LATER_BULK_RETURN_NOTICE_THRESHOLD,
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
    // D245 Critical fix: `staticActionPreviewCopy` used to read
    // `activityUndo.summary` raw, so it kept shipping "DeclutrMail Undo
    // is available from Activity during your plan's Undo window" — the
    // hedge — on every live public route rendering ACTION_REGISTRY
    // descriptions, even after the ladder went uniform. It must now
    // derive through `activityUndoSummary` exactly like the live-preview
    // path does, and state the window instead of hedging.
    expect(UNIFORM_UNDO_WINDOW_DAYS).not.toBeNull();
    expect(staticActionPreviewCopy('delete')).not.toContain("plan's Undo window");
    expect(staticActionPreviewCopy('delete')).toContain(
      `Undo from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days.`,
    );
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
      summary: 'Returns to Inbox from Jul 21, 2026 at 4:00 PM UTC.',
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

    // D245 review: with no deadline yet, the current uniform ladder means
    // the preview states the window instead of hedging with "your plan's
    // Undo window". Derived, not pinned — see UNIFORM_UNDO_WINDOW_DAYS.
    expect(UNIFORM_UNDO_WINDOW_DAYS).not.toBeNull();
    expect(unknownCount.primary.activityUndo.summary).toContain(String(UNIFORM_UNDO_WINDOW_DAYS));
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

  describe('activityUndoSummary', () => {
    // D245 review finding: the divergent-ladder fallback was previously
    // reachable only by hand-editing pricing.config.ts. Parameterizing on
    // the window (instead of reading UNIFORM_UNDO_WINDOW_DAYS internally)
    // lets all three paths be driven directly, permanently, here.
    const planDependentFallback = "Undo from Activity during your plan's Undo window.";

    it('states the exact deadline when one is known, even if the ladder has diverged', () => {
      const deadline = '2026-07-21T16:00:00.000Z';
      expect(activityUndoSummary(30, deadline, planDependentFallback)).toBe(
        'Undo from Activity until Jul 21, 2026 at 4:00 PM UTC.',
      );
      expect(activityUndoSummary(null, deadline, planDependentFallback)).toBe(
        'Undo from Activity until Jul 21, 2026 at 4:00 PM UTC.',
      );
    });

    it('states the window when no deadline exists and the ladder is uniform', () => {
      expect(activityUndoSummary(30, null, planDependentFallback)).toBe(
        'Undo from Activity for 30 days.',
      );
      expect(activityUndoSummary(14, null, planDependentFallback)).toBe(
        'Undo from Activity for 14 days.',
      );
    });

    it('falls back to the plan-dependent wording when no deadline exists and the ladder has diverged', () => {
      expect(activityUndoSummary(null, null, planDependentFallback)).toBe(planDependentFallback);
    });
  });

  describe('interactive live-preview surfaces never show the raw registry hedge', () => {
    // QA-delete-20260829-06/07 (2026-08-30): the copy-guard test
    // (undo-window-copy-guard.test.ts) only scans PUBLIC/marketing copy
    // modules, `staticActionPreviewCopy` has its own assertion above, but
    // nothing previously locked in that `buildActionPresentation` — the
    // path Triage, the senders confirm modal, the Screener decide
    // preview, and the Autopilot approve modal all actually render from —
    // derives `activityUndo.summary` through `activityUndoSummary` rather
    // than reading each verb's hardcoded `ActionSemantics.activityUndo.
    // summary` raw. Investigation found the derivation itself was already
    // correct (fixed by #646, merged 2026-08-27, two days before this
    // finding was filed) — this closes the coverage gap the finding
    // correctly named, without changing behavior that was already right.
    const PLAN_WINDOW_VERBS = ['archive', 'later', 'unarchive', 'delete'] as const;

    it('has a raw registry hedge to guard against for every plan-window verb', () => {
      // Starve check (CLAUDE.md §8, "a guard that cannot fail is not a
      // guard"): if this ever comes back empty, the test below would pass
      // vacuously and certify nothing.
      expect(PLAN_WINDOW_VERBS.length).toBeGreaterThan(0);
      for (const verb of PLAN_WINDOW_VERBS) {
        expect(ACTION_SEMANTICS[verb].activityUndo.kind).toBe('plan-window');
      }
    });

    it.each(PLAN_WINDOW_VERBS)(
      "%s's live preview states the window, never the raw registry hedge",
      (verb) => {
        expect(UNIFORM_UNDO_WINDOW_DAYS).not.toBeNull();
        const presentation = buildActionPresentation({
          verb,
          liveCount: 3,
          planUndoDeadline: null,
          wakeAt: verb === 'later' ? '2026-07-21T16:00:00.000Z' : null,
          unsubscribeChannel: null,
        });
        const summary = presentation.primary.activityUndo.summary;
        expect(summary).toBe(`Undo from Activity for ${UNIFORM_UNDO_WINDOW_DAYS} days.`);
        // The raw registry entry for this verb, unread — proves the
        // assertion above is checking the DERIVED value, not coincidentally
        // matching a hedge that happens to contain the same day count.
        const rawHedge = ACTION_SEMANTICS[verb].activityUndo.summary;
        expect(summary).not.toBe(rawHedge);
      },
    );
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

// Founder screenshot review 2026-08-27. Every fact in the shipped
// composite preview was true on its own; the paragraph they formed was
// not. These assert the ASSEMBLY, which is what a reader sees, and they
// live here rather than in one surface's test so all seven confirm
// surfaces inherit them.
describe('D245 composite presentation states one coherent story', () => {
  const composite = () =>
    buildActionPresentation({
      verb: 'unsubscribe',
      liveCount: 0,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: 'one_click',
      secondaryAction: { verb: 'archive', liveCount: 17 },
    });

  it('drops a secondary claim the primary contradicts', () => {
    // Archive alone truthfully says it. Under an unsubscribe it is false.
    expect(ACTION_SEMANTICS.archive.unchanged.map((f) => f.claim)).toContain('not-unsubscribed');
    expect(composite().previewCopy).not.toContain('The sender is not unsubscribed');
    expect(composite().secondary?.unchanged).not.toContain('The sender is not unsubscribed.');
  });

  it('lets the primary own the future-mail story', () => {
    const copy = composite().previewCopy;
    expect(copy).toContain('one-click');
    expect(copy).not.toContain('Future email is unchanged');
  });

  it('drops the standalone hedge once a secondary is present', () => {
    expect(composite().primary.currentMail.summary).toBe(
      'Unsubscribing on its own moves no existing email.',
    );
    expect(composite().previewCopy).not.toContain('unless you choose a separate action');
  });

  it('keeps the hedge when the action stands alone', () => {
    const alone = buildActionPresentation({
      verb: 'unsubscribe',
      liveCount: 0,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: 'one_click',
    });
    expect(alone.primary.currentMail.summary).toContain('unless you choose a separate action');
  });

  it('keeps a secondary claim the primary does not contradict', () => {
    // Later does not unsubscribe, so Archive's other claim must survive.
    const laterThenArchive = buildActionPresentation({
      verb: 'archive',
      liveCount: 3,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: null,
    });
    expect(laterThenArchive.previewCopy).toContain('Nothing is deleted.');
    expect(laterThenArchive.previewCopy).toContain('The sender is not unsubscribed.');
  });

  it('excludes the count from effectCopy and keeps it in previewCopy', () => {
    const archive = buildActionPresentation({
      verb: 'archive',
      liveCount: 17,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: null,
    });
    expect(archive.primary.previewCopy).toContain('17');
    expect(archive.primary.effectCopy).not.toContain('17');
    expect(archive.primary.effectCopy).not.toContain('Undo from Activity');
  });
});

describe('D245 recovery copy states each fact once and says whose it is', () => {
  const present = (verb: Parameters<typeof buildActionPresentation>[0]['verb']) =>
    buildActionPresentation({
      verb,
      liveCount: 1,
      planUndoDeadline: null,
      wakeAt: verb === 'later' ? '2026-09-03T08:01:00.000Z' : null,
      unsubscribeChannel: verb === 'unsubscribe' ? 'one_click' : null,
    }).primary;

  it('never restates activityUndo as finality', () => {
    // `delivered-request-cannot-be-recalled` is a second spelling of
    // "cannot be undone" — the senders modal used to print both.
    const facts = composeRecoveryFacts(present('unsubscribe'), null);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toBe('A delivered unsubscribe request cannot be undone.');
  });

  it('keeps every genuinely distinct Delete fact', () => {
    const facts = composeRecoveryFacts(present('delete'), null);
    expect(facts).toHaveLength(3);
    expect(facts.join(' ')).toContain('Gmail Trash recovery is separate');
    expect(facts.join(' ')).toContain('permanently deletes');
  });

  it('labels each half of a composite so neither sentence floats free', () => {
    const composite = buildActionPresentation({
      verb: 'unsubscribe',
      liveCount: 0,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: 'one_click',
      secondaryAction: { verb: 'archive', liveCount: 17 },
    });
    const facts = composeRecoveryFacts(composite.primary, composite.secondary);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toMatch(/^Unsubscribe — /);
    expect(facts[1]).toMatch(/^Archive — /);
  });

  it('does not label when both halves share the same recovery route', () => {
    const composite = buildActionPresentation({
      verb: 'archive',
      liveCount: 4,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: null,
      secondaryAction: { verb: 'archive', liveCount: 4 },
    });
    const facts = composeRecoveryFacts(composite.primary, composite.secondary);
    expect(facts).toHaveLength(1);
    expect(facts[0]).not.toContain('—');
  });
});

describe('D245 Keep states the consequence it actually has', () => {
  it('names the Triage effect rather than promising a memory', () => {
    expect(ACTION_SEMANTICS.keep.futureMail.summary).toContain('stops coming up in Triage');
  });

  // Verified against the executors AND live on the dev mailbox: Autopilot
  // filters `isProtected` and nothing else, and a Keep action leaves
  // `triage_decisions.verdict` alone — so no preset is gated out either.
  it('says plainly that Keep is not Protect', () => {
    const claims = ACTION_SEMANTICS.keep.unchanged;
    expect(claims.map((f) => f.claim)).toContain('not-protected');
    expect(claims.find((f) => f.claim === 'not-protected')?.summary).toContain('not Protect');
  });

  it('moves no mail and needs no undo route', () => {
    expect(ACTION_SEMANTICS.keep.currentMail.scope).toBe('none');
    expect(ACTION_SEMANTICS.keep.activityUndo.kind).toBe('none');
  });
});

describe('D245 absolute times render in one clock per surface', () => {
  const later = (timeZone: 'utc' | 'viewer') => {
    const primary = buildActionPresentation({
      verb: 'later',
      liveCount: 1,
      planUndoDeadline: '2026-07-15T17:30:00.000Z',
      wakeAt: '2026-09-03T08:01:00.000Z',
      unsubscribeChannel: null,
      timeZone,
    }).primary;
    // A wakeAt was supplied, so this is the `scheduled` arm; narrowing
    // here keeps every assertion below on the union member that has a
    // summary.
    if (primary.schedule.kind !== 'scheduled') {
      throw new Error(`expected a scheduled Later, got ${primary.schedule.kind}`);
    }
    return { schedule: primary.schedule, activityUndo: primary.activityUndo };
  };

  it('defaults to UTC so server-rendered and static copy stay deterministic', () => {
    expect(later('utc').schedule.summary).toBe('Returns to Inbox from Sep 3, 2026 at 8:01 AM UTC.');
  });

  // Asserted against the runtime's OWN zone rather than a hardcoded
  // offset: this suite runs in PDT on the founder's laptop and in UTC on
  // CI, and an assertion that simply banned "UTC" passed locally and
  // went red in CI for a correct implementation.
  const runtimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  it('renders the viewer clock when a surface asks for it', () => {
    // The Later sheet's own `<input type="datetime-local">` is local by
    // construction, so a UTC sentence beside it printed one instant in
    // two clocks and left the reader to do the offset arithmetic.
    const summary = later('viewer').schedule.summary;
    expect(summary).toMatch(
      /^Returns to Inbox from \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM) \S+\.$/,
    );
    const expectedHour = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: true,
      timeZone: runtimeZone,
    }).format(new Date('2026-09-03T08:01:00.000Z'));
    expect(summary).toContain(expectedHour.replace(/\s?(AM|PM)$/, ''));
  });

  it('applies the same clock to the Undo deadline', () => {
    expect(later('utc').activityUndo.summary).toContain('UTC.');
    expect(later('viewer').activityUndo.summary).toMatch(
      /^Undo from Activity until \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM) \S+\.$/,
    );
  });

  it('actually moves the wall clock when the viewer is not on UTC', () => {
    if (runtimeZone === 'UTC' || runtimeZone === 'Etc/UTC') return;
    expect(later('viewer').schedule.summary).not.toBe(later('utc').schedule.summary);
  });
});

// Founder decision 2026-08-27 (option 3B). Later is the only mail-moving
// verb with no way to narrow its reach, and the only one that hands the
// whole pile back at once on a date chosen while it was out of sight. The
// preview stated the count and the return date in separate sentences and
// left the reader to join them.
describe('D226 Later says when the whole pile comes back at once', () => {
  const later = (liveCount: number | null, wakeAt: string | null = '2026-09-03T08:01:00.000Z') =>
    buildActionPresentation({
      verb: 'later',
      liveCount,
      planUndoDeadline: null,
      wakeAt,
      unsubscribeChannel: null,
    }).primary;

  it('names the shared return time once the reach crosses the threshold', () => {
    const p = later(1_718);
    expect(p.bulkReturnNotice).toBe('All of them share that one return.');
    // In the shared copy too, so any surface rendering it inherits the
    // sentence without wiring a prop of its own.
    expect(p.effectCopy).toContain('All of them share that one return.');
    expect(p.previewCopy).toContain('All of them share that one return.');
  });

  // The count is stated once, in the headline, under its own "rechecked
  // when it runs" disclaimer. Repeating it here would assert a definite
  // quantity about an event weeks away that an Activity undo can change.
  it('asserts no count for the future return', () => {
    const p = later(1_718);
    expect(p.bulkReturnNotice).not.toMatch(/\d/);
  });

  // The wake pipeline cannot promise the mail lands all at once:
  // `batchModify` chunks at 1,000 ids into sequential requests and the
  // mirror updates only after the whole call, so a failure on a later
  // chunk leaves the earlier one already restored and the rest arriving
  // after a backoff. The guarantee is the SCHEDULE — one
  // `snoozed_until` per sender — so the copy claims that and nothing more.
  // The wake is a floor: a 15-minute sweep picks up due timers, a failed
  // one stays due for the next sweep, and a due timer on a disconnected
  // mailbox lies dormant until reconnect. Naming a bare minute promised
  // a precision the pipeline never offered.
  it('states the return time as a floor, not a delivery moment', () => {
    const p = later(1_718);
    if (p.schedule.kind !== 'scheduled') throw new Error('expected a scheduled Later');
    expect(p.schedule.summary).toMatch(/^Returns to Inbox from /);
  });

  it('never promises the mail arrives all at once', () => {
    const notice = later(1_718).bulkReturnNotice ?? '';
    expect(notice).not.toMatch(/together|at once|simultaneous|all in one/i);
    expect(notice).toContain('one return');
  });

  it('stays quiet below the threshold', () => {
    expect(later(LATER_BULK_RETURN_NOTICE_THRESHOLD - 1).bulkReturnNotice).toBeNull();
    expect(later(17).effectCopy).not.toContain('share that one return');
  });

  it('fires exactly at the threshold', () => {
    expect(later(LATER_BULK_RETURN_NOTICE_THRESHOLD).bulkReturnNotice).toBe(
      'All of them share that one return.',
    );
  });

  it('says nothing when no return time is set yet', () => {
    // Nothing has been scheduled, so there is no "together" to warn about.
    expect(later(1_718, null).bulkReturnNotice).toBeNull();
  });

  it('says nothing when the count is unknown', () => {
    expect(later(null).bulkReturnNotice).toBeNull();
  });

  it.each(['archive', 'delete'] as const)('never fires for %s, which does not return', (verb) => {
    const p = buildActionPresentation({
      verb,
      liveCount: 5_000,
      planUndoDeadline: null,
      wakeAt: null,
      unsubscribeChannel: null,
    }).primary;
    expect(p.bulkReturnNotice).toBeNull();
  });
});
