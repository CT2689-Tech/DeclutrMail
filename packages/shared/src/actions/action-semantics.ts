import type { ActionJobStatus } from '../contracts/action-job-status';
import type { ActionVerb } from '../contracts/verb-constants';

export type CurrentMailScope = 'none' | 'matching-current-inbox' | 'matching-archived';
export type CurrentMailDestination =
  'unchanged' | 'gmail-all-mail' | 'declutrmail-later' | 'gmail-trash' | 'gmail-inbox';
export type FutureMailEffect = 'unchanged' | 'remember-keep' | 'unsubscribe-request';

export type ActionScheduleRequirement =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'required';
      readonly parameter: 'wakeAt';
      readonly validation: 'future-iso-datetime';
      readonly summary: string;
    };

export type ActivityUndoSemantics =
  | { readonly kind: 'none'; readonly summary: string }
  | {
      readonly kind: 'plan-window';
      readonly summary: string;
    };

export type ProviderRecoverySemantics =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'gmail-trash';
      readonly approximateDays: 30;
      readonly summary: string;
    };

export type ActionFinality =
  | { readonly kind: 'reversible-or-changeable'; readonly summary: string }
  | {
      readonly kind: 'delivered-request-cannot-be-recalled';
      readonly summary: string;
    }
  | {
      readonly kind: 'provider-permanent-deletion';
      readonly summary: string;
    };

export interface ActionSemantics {
  readonly verb: ActionVerb;
  readonly label: string;
  readonly currentMail: {
    readonly scope: CurrentMailScope;
    readonly destination: CurrentMailDestination;
    readonly summary: string;
  };
  readonly futureMail: {
    readonly effect: FutureMailEffect;
    readonly summary: string;
  };
  readonly unchanged: readonly string[];
  readonly schedule: ActionScheduleRequirement;
  readonly activityUndo: ActivityUndoSemantics;
  readonly providerRecovery: ProviderRecoverySemantics;
  readonly finality: ActionFinality;
  readonly resultLabel: string;
}

export type ActionSemanticsRegistry = {
  readonly [Verb in ActionVerb]: ActionSemantics & { readonly verb: Verb };
};

/**
 * D245 canonical behavioral contract for every registered action.
 *
 * UI previews add the live count, sender, selected time range, plan-derived
 * Undo deadline, and (for Later) selected wake time around these facts. No
 * surface should invent its own current/future/recovery semantics.
 */
export const ACTION_SEMANTICS: ActionSemanticsRegistry = {
  keep: {
    verb: 'keep',
    label: 'Keep',
    currentMail: {
      scope: 'none',
      destination: 'unchanged',
      summary: 'No existing email moves.',
    },
    futureMail: {
      effect: 'remember-keep',
      summary: 'DeclutrMail remembers Keep as your decision for this sender.',
    },
    unchanged: ['Gmail labels and delivery settings are unchanged.'],
    schedule: { kind: 'none' },
    activityUndo: {
      kind: 'none',
      summary: 'Change this sender decision at any time.',
    },
    providerRecovery: { kind: 'none' },
    finality: {
      kind: 'reversible-or-changeable',
      summary: 'This saved decision can be changed.',
    },
    resultLabel: 'Keep decision saved',
  },
  archive: {
    verb: 'archive',
    label: 'Archive',
    currentMail: {
      scope: 'matching-current-inbox',
      destination: 'gmail-all-mail',
      summary: 'Matching email currently in Inbox moves out of Inbox and stays in Gmail.',
    },
    futureMail: { effect: 'unchanged', summary: 'Future email is unchanged.' },
    unchanged: ['Nothing is deleted.', 'The sender is not unsubscribed.'],
    schedule: { kind: 'none' },
    activityUndo: {
      kind: 'plan-window',
      summary: "Undo from Activity during your plan's Undo window.",
    },
    providerRecovery: { kind: 'none' },
    finality: {
      kind: 'reversible-or-changeable',
      summary: 'Activity Undo restores the prior Inbox label during the available window.',
    },
    resultLabel: 'Archived',
  },
  later: {
    verb: 'later',
    label: 'Later',
    currentMail: {
      scope: 'matching-current-inbox',
      destination: 'declutrmail-later',
      summary: 'Matching email currently in Inbox moves to the DeclutrMail/Later label.',
    },
    futureMail: { effect: 'unchanged', summary: 'Future email is unchanged.' },
    unchanged: ['Nothing is deleted.', 'The sender is not unsubscribed.'],
    schedule: {
      kind: 'required',
      parameter: 'wakeAt',
      validation: 'future-iso-datetime',
      summary: 'Choose when the email returns to Inbox.',
    },
    activityUndo: {
      kind: 'plan-window',
      summary: "Undo from Activity during your plan's Undo window.",
    },
    providerRecovery: { kind: 'none' },
    finality: {
      kind: 'reversible-or-changeable',
      summary: 'Activity Undo or the scheduled wake restores the email to Inbox.',
    },
    resultLabel: 'Moved to Later',
  },
  unsubscribe: {
    verb: 'unsubscribe',
    label: 'Unsubscribe',
    currentMail: {
      scope: 'none',
      destination: 'unchanged',
      summary: 'Existing email stays where it is unless you choose a separate backlog action.',
    },
    futureMail: {
      effect: 'unsubscribe-request',
      summary:
        'DeclutrMail sends a supported one-click request, or opens a prefilled Gmail draft for you to send.',
    },
    unchanged: ['Existing email is not moved by Unsubscribe alone.'],
    schedule: { kind: 'none' },
    activityUndo: {
      kind: 'none',
      summary: 'A delivered unsubscribe request cannot be undone.',
    },
    providerRecovery: { kind: 'none' },
    finality: {
      kind: 'delivered-request-cannot-be-recalled',
      summary: 'After delivery, the unsubscribe request cannot be recalled.',
    },
    resultLabel: 'Unsubscribe request recorded',
  },
  unarchive: {
    verb: 'unarchive',
    label: 'Restore to Inbox',
    currentMail: {
      scope: 'matching-archived',
      destination: 'gmail-inbox',
      summary: 'Matching archived email returns to Inbox.',
    },
    futureMail: { effect: 'unchanged', summary: 'Future email is unchanged.' },
    unchanged: ['Nothing is deleted.', 'The sender is not subscribed or unsubscribed.'],
    schedule: { kind: 'none' },
    activityUndo: {
      kind: 'plan-window',
      summary: "Undo from Activity during your plan's Undo window.",
    },
    providerRecovery: { kind: 'none' },
    finality: {
      kind: 'reversible-or-changeable',
      summary: 'Activity Undo removes the restored Inbox label during the available window.',
    },
    resultLabel: 'Restored to Inbox',
  },
  delete: {
    verb: 'delete',
    label: 'Delete',
    currentMail: {
      scope: 'matching-current-inbox',
      destination: 'gmail-trash',
      summary: 'Matching email currently in Inbox moves to Gmail Trash.',
    },
    futureMail: { effect: 'unchanged', summary: 'Future email is unchanged.' },
    unchanged: ['The sender is not unsubscribed.'],
    schedule: { kind: 'none' },
    activityUndo: {
      kind: 'plan-window',
      summary: "DeclutrMail Undo is available from Activity during your plan's Undo window.",
    },
    providerRecovery: {
      kind: 'gmail-trash',
      approximateDays: 30,
      summary: 'Gmail Trash recovery is separate and is normally available for up to 30 days.',
    },
    finality: {
      kind: 'provider-permanent-deletion',
      summary: 'Gmail permanently deletes email after its Trash retention period.',
    },
    resultLabel: 'Moved to Gmail Trash',
  },
};

export function getActionSemantics<Verb extends ActionVerb>(
  verb: Verb,
): ActionSemanticsRegistry[Verb] {
  return ACTION_SEMANTICS[verb];
}

/** Static preview facts; live previews prepend scope/count and append deadlines. */
export function staticActionPreviewCopy(verb: ActionVerb): string {
  const semantics = ACTION_SEMANTICS[verb];
  const recovery = [semantics.activityUndo.summary];
  if (semantics.providerRecovery.kind !== 'none') {
    recovery.push(semantics.providerRecovery.summary);
  }
  if (semantics.finality.kind !== 'reversible-or-changeable') {
    recovery.push(semantics.finality.summary);
  }
  return [
    semantics.currentMail.summary,
    semantics.futureMail.summary,
    ...semantics.unchanged,
    ...recovery,
  ].join(' ');
}

export function actionHasRecovery(verb: ActionVerb): boolean {
  const semantics = ACTION_SEMANTICS[verb];
  return (
    semantics.finality.kind === 'reversible-or-changeable' ||
    semantics.activityUndo.kind !== 'none' ||
    semantics.providerRecovery.kind !== 'none'
  );
}

/** D245 default Later preset used by every producer unless the user picks another time. */
export const DEFAULT_LATER_WAKE_DAYS = 7;

export function defaultLaterWakeAtIso(now = new Date()): string {
  return new Date(now.getTime() + DEFAULT_LATER_WAKE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** The three unsubscribe capabilities stored on a sender. */
export type UnsubscribeChannel = 'one_click' | 'mailto' | 'none';

export interface SecondaryActionPresentationInput {
  readonly verb: ActionVerb;
  /** Null when the surface has no exact email count (for example Autopilot). */
  readonly liveCount: number | null;
}

/**
 * Every dynamic fact a confirmation surface may need. Keeping these inputs
 * together prevents modals, rows, and receipts from independently inventing
 * action behavior or recovery copy.
 */
export interface ActionPresentationInput {
  readonly verb: ActionVerb;
  /** Null means unavailable; the builder omits the count instead of guessing. */
  readonly liveCount: number | null;
  readonly planUndoDeadline: string | null;
  readonly wakeAt: string | null;
  readonly unsubscribeChannel: UnsubscribeChannel | null;
  readonly secondaryAction?: SecondaryActionPresentationInput | null;
}

export type ActionPresentationSchedule =
  | { readonly kind: 'none'; readonly wakeAt: null }
  | { readonly kind: 'required'; readonly wakeAt: null; readonly summary: string }
  | { readonly kind: 'scheduled'; readonly wakeAt: string; readonly summary: string };

export type ActionPresentationActivityUndo =
  | { readonly kind: 'none'; readonly deadline: null; readonly summary: string }
  | {
      readonly kind: 'plan-window';
      readonly deadline: string | null;
      readonly summary: string;
    };

export type ActionPresentationUnsubscribeChannel =
  | { readonly kind: 'not-applicable' }
  | {
      readonly kind: UnsubscribeChannel | 'unknown';
      readonly summary: string;
    };

export interface PresentedAction {
  readonly verb: ActionVerb;
  readonly label: string;
  readonly resultLabel: string;
  readonly liveCount: number | null;
  readonly currentMail: ActionSemantics['currentMail'];
  readonly futureMail: ActionSemantics['futureMail'];
  readonly unchanged: readonly string[];
  readonly schedule: ActionPresentationSchedule;
  readonly activityUndo: ActionPresentationActivityUndo;
  readonly unsubscribeChannel: ActionPresentationUnsubscribeChannel;
  readonly providerRecovery: ProviderRecoverySemantics;
  readonly finality: ActionFinality;
  /** Ordered, presentation-ready facts used to assemble `previewCopy`. */
  readonly facts: readonly string[];
  readonly previewCopy: string;
}

export interface ActionPresentation {
  readonly primary: PresentedAction;
  readonly secondary: PresentedAction | null;
  /** Null when any included action lacks an exact count. */
  readonly totalLiveCount: number | null;
  readonly previewCopy: string;
}

/**
 * Canonical action presentation builder (D245).
 *
 * It deliberately returns both structured facts and assembled copy: rich
 * surfaces can render the fields, while compact surfaces can use one truthful
 * sentence without reimplementing count, scheduling, channel, or recovery
 * semantics.
 */
export function buildActionPresentation(input: ActionPresentationInput): ActionPresentation {
  const primary = presentAction({
    verb: input.verb,
    liveCount: input.liveCount,
    planUndoDeadline: input.planUndoDeadline,
    wakeAt: input.wakeAt,
    unsubscribeChannel: input.unsubscribeChannel,
  });
  const secondary = input.secondaryAction
    ? presentAction({
        verb: input.secondaryAction.verb,
        liveCount: input.secondaryAction.liveCount,
        planUndoDeadline: input.planUndoDeadline,
        wakeAt: input.wakeAt,
        unsubscribeChannel: input.unsubscribeChannel,
      })
    : null;

  const totalLiveCount =
    primary.liveCount === null || (secondary !== null && secondary.liveCount === null)
      ? null
      : primary.liveCount + (secondary?.liveCount ?? 0);

  return {
    primary,
    secondary,
    totalLiveCount,
    previewCopy: secondary
      ? `${primary.previewCopy} Also: ${secondary.previewCopy}`
      : primary.previewCopy,
  };
}

interface PresentActionInput {
  readonly verb: ActionVerb;
  readonly liveCount: number | null;
  readonly planUndoDeadline: string | null;
  readonly wakeAt: string | null;
  readonly unsubscribeChannel: UnsubscribeChannel | null;
}

function presentAction(input: PresentActionInput): PresentedAction {
  if (input.liveCount !== null) {
    assertLiveCount(input.liveCount);
  }
  const semantics = ACTION_SEMANTICS[input.verb];
  const countSummary =
    input.liveCount === null ? null : presentationCountSummary(input.verb, input.liveCount);
  const schedule = presentationSchedule(semantics, input.wakeAt);
  const activityUndo = presentationActivityUndo(semantics, input.planUndoDeadline);
  const unsubscribeChannel = presentationUnsubscribeChannel(input.verb, input.unsubscribeChannel);
  const futureMailSummary =
    unsubscribeChannel.kind === 'not-applicable'
      ? semantics.futureMail.summary
      : unsubscribeChannel.summary;
  const facts = [
    ...(countSummary === null ? [] : [countSummary]),
    semantics.currentMail.summary,
    futureMailSummary,
    ...semantics.unchanged,
    ...(schedule.kind === 'none' ? [] : [schedule.summary]),
    activityUndo.summary,
    ...(semantics.providerRecovery.kind === 'none' ? [] : [semantics.providerRecovery.summary]),
    ...(semantics.finality.kind === 'reversible-or-changeable' ? [] : [semantics.finality.summary]),
  ];

  return {
    verb: input.verb,
    label: semantics.label,
    resultLabel: semantics.resultLabel,
    liveCount: input.liveCount,
    currentMail: semantics.currentMail,
    futureMail: semantics.futureMail,
    unchanged: semantics.unchanged,
    schedule,
    activityUndo,
    unsubscribeChannel,
    providerRecovery: semantics.providerRecovery,
    finality: semantics.finality,
    facts,
    previewCopy: facts.join(' '),
  };
}

function assertLiveCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('liveCount must be a non-negative safe integer.');
  }
}

function presentationCountSummary(verb: ActionVerb, count: number): string | null {
  if (verb === 'keep' || verb === 'unsubscribe') {
    return null;
  }
  return `${count} matching ${count === 1 ? 'email' : 'emails'}.`;
}

function presentationSchedule(
  semantics: ActionSemantics,
  wakeAt: string | null,
): ActionPresentationSchedule {
  if (semantics.schedule.kind === 'none') {
    return { kind: 'none', wakeAt: null };
  }
  if (wakeAt === null) {
    return { kind: 'required', wakeAt: null, summary: semantics.schedule.summary };
  }
  return {
    kind: 'scheduled',
    wakeAt,
    summary: `Returns to Inbox ${formatIsoUtc(wakeAt)}.`,
  };
}

function presentationActivityUndo(
  semantics: ActionSemantics,
  deadline: string | null,
): ActionPresentationActivityUndo {
  if (semantics.activityUndo.kind === 'none') {
    return { kind: 'none', deadline: null, summary: semantics.activityUndo.summary };
  }
  return {
    kind: 'plan-window',
    deadline,
    summary:
      deadline === null
        ? semantics.activityUndo.summary
        : `Undo from Activity until ${formatIsoUtc(deadline)}.`,
  };
}

/** Stable display copy until surfaces provide mailbox-timezone formatting. */
function formatIsoUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Action presentation dates must be valid ISO date-time strings.');
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ] as const;
  const hours = date.getUTCHours();
  const hour = hours % 12 || 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const period = hours < 12 ? 'AM' : 'PM';
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hour}:${minutes} ${period} UTC`;
}

function presentationUnsubscribeChannel(
  verb: ActionVerb,
  channel: UnsubscribeChannel | null,
): ActionPresentationUnsubscribeChannel {
  if (verb !== 'unsubscribe') {
    return { kind: 'not-applicable' };
  }
  if (channel === 'one_click') {
    return {
      kind: channel,
      summary: 'DeclutrMail sends a supported one-click unsubscribe request.',
    };
  }
  if (channel === 'mailto') {
    return {
      kind: channel,
      summary: 'DeclutrMail opens a prefilled Gmail draft; you send it.',
    };
  }
  if (channel === 'none') {
    return { kind: channel, summary: 'No supported unsubscribe channel is available.' };
  }
  return {
    kind: 'unknown',
    summary: ACTION_SEMANTICS.unsubscribe.futureMail.summary,
  };
}

/** Verbs that produce `action_jobs` status handles today. */
export type ActionJobVerb = 'archive' | 'later' | 'delete' | 'unsubscribe';
export type ActionDirection = 'forward' | 'reverse';

/**
 * Additive wire snapshot returned by `GET /api/actions/:id`. It is shared so
 * API and web cannot drift while the receipt remains a pure derivation.
 */
export interface ActionStatusSnapshot {
  readonly actionId: string;
  readonly verb: ActionJobVerb;
  readonly direction: ActionDirection;
  readonly status: ActionJobStatus;
  readonly requestedCount: number;
  readonly affectedCount: number;
  readonly wakeAt: string | null;
  readonly undoToken: string | null;
  readonly undoExpiresAt: string | null;
  readonly undoExecutedAt: string | null;
  readonly undoRevertedAt: string | null;
  readonly errorCode: string | null;
}

export type ActivityUndoResult =
  | { readonly state: 'not-applicable'; readonly token: null; readonly deadline: null }
  | { readonly state: 'pending'; readonly token: null; readonly deadline: null }
  | { readonly state: 'unavailable'; readonly token: null; readonly deadline: null }
  | { readonly state: 'available'; readonly token: string; readonly deadline: string }
  | { readonly state: 'expired'; readonly token: string; readonly deadline: string }
  | {
      readonly state: 'reverting';
      readonly token: string;
      readonly deadline: string | null;
    }
  | {
      readonly state: 'revert-failed';
      readonly token: string;
      readonly deadline: string | null;
    }
  | {
      readonly state: 'reverted';
      readonly token: string;
      readonly deadline: string | null;
      readonly revertedAt: string | null;
    }
  | { readonly state: 'unknown'; readonly token: string; readonly deadline: string | null };

export type ActionWakeResult =
  | { readonly kind: 'none'; readonly at: null }
  | { readonly kind: 'scheduled'; readonly at: string };

interface ActionReceiptResultBase {
  readonly actionId: string;
  readonly verb: ActionJobVerb;
  readonly direction: ActionDirection;
  readonly requestedCount: number;
  readonly affectedCount: number;
  readonly wake: ActionWakeResult;
  readonly activityUndo: ActivityUndoResult;
  readonly providerRecovery: ProviderRecoverySemantics;
  readonly finality: ActionFinality;
}

/**
 * Canonical discriminated receipt. Counts are retained on every branch so a
 * failed or partial operation never collapses into a misleading binary toast.
 */
export type ActionReceiptResult =
  | (ActionReceiptResultBase & {
      readonly state: 'pending';
      readonly status: 'queued' | 'executing';
      readonly outcome: 'pending';
      readonly errorCode: null;
    })
  | (ActionReceiptResultBase & {
      readonly state: 'succeeded';
      readonly status: 'done';
      readonly outcome: 'applied' | 'partial' | 'no-op';
      readonly errorCode: null;
    })
  | (ActionReceiptResultBase & {
      readonly state: 'failed';
      readonly status: 'failed';
      readonly outcome: 'failure';
      readonly errorCode: string | null;
    });

/** Build a truthful receipt/result from one status poll response. */
export function buildActionReceiptResult(
  snapshot: ActionStatusSnapshot,
  now = new Date(),
): ActionReceiptResult {
  const semantics = ACTION_SEMANTICS[snapshot.verb];
  const base: ActionReceiptResultBase = {
    actionId: snapshot.actionId,
    verb: snapshot.verb,
    direction: snapshot.direction,
    requestedCount: snapshot.requestedCount,
    affectedCount: snapshot.affectedCount,
    wake: snapshot.wakeAt ? { kind: 'scheduled', at: snapshot.wakeAt } : { kind: 'none', at: null },
    activityUndo: deriveActivityUndoResult(snapshot, semantics, now),
    providerRecovery: semantics.providerRecovery,
    finality: semantics.finality,
  };

  if (snapshot.status === 'failed') {
    return {
      ...base,
      state: 'failed',
      status: snapshot.status,
      outcome: 'failure',
      errorCode: snapshot.errorCode,
    };
  }
  if (snapshot.status === 'done') {
    const outcome =
      snapshot.affectedCount === 0
        ? 'no-op'
        : snapshot.affectedCount < snapshot.requestedCount
          ? 'partial'
          : 'applied';
    return {
      ...base,
      state: 'succeeded',
      status: snapshot.status,
      outcome,
      errorCode: null,
    };
  }
  return {
    ...base,
    state: 'pending',
    status: snapshot.status,
    outcome: 'pending',
    errorCode: null,
  };
}

function deriveActivityUndoResult(
  snapshot: ActionStatusSnapshot,
  semantics: ActionSemantics,
  now: Date,
): ActivityUndoResult {
  if (semantics.activityUndo.kind === 'none') {
    return { state: 'not-applicable', token: null, deadline: null };
  }
  if (snapshot.direction === 'reverse') {
    if (snapshot.undoToken === null) {
      return { state: 'unavailable', token: null, deadline: null };
    }
    if (snapshot.status === 'failed') {
      return {
        state: 'revert-failed',
        token: snapshot.undoToken,
        deadline: snapshot.undoExpiresAt,
      };
    }
    if (snapshot.status === 'done' || snapshot.undoRevertedAt !== null) {
      return {
        state: 'reverted',
        token: snapshot.undoToken,
        deadline: snapshot.undoExpiresAt,
        revertedAt: snapshot.undoRevertedAt,
      };
    }
    return {
      state: 'reverting',
      token: snapshot.undoToken,
      deadline: snapshot.undoExpiresAt,
    };
  }
  if (snapshot.status === 'queued' || snapshot.status === 'executing') {
    return { state: 'pending', token: null, deadline: null };
  }
  if (snapshot.undoToken === null) {
    return { state: 'unavailable', token: null, deadline: null };
  }
  if (snapshot.undoRevertedAt !== null) {
    return {
      state: 'reverted',
      token: snapshot.undoToken,
      deadline: snapshot.undoExpiresAt,
      revertedAt: snapshot.undoRevertedAt,
    };
  }
  if (snapshot.undoExecutedAt !== null) {
    return {
      state: 'reverting',
      token: snapshot.undoToken,
      deadline: snapshot.undoExpiresAt,
    };
  }
  if (snapshot.undoExpiresAt === null) {
    return { state: 'unknown', token: snapshot.undoToken, deadline: null };
  }
  const expiry = Date.parse(snapshot.undoExpiresAt);
  if (Number.isNaN(expiry)) {
    return {
      state: 'unknown',
      token: snapshot.undoToken,
      deadline: snapshot.undoExpiresAt,
    };
  }
  return expiry <= now.getTime()
    ? { state: 'expired', token: snapshot.undoToken, deadline: snapshot.undoExpiresAt }
    : { state: 'available', token: snapshot.undoToken, deadline: snapshot.undoExpiresAt };
}
