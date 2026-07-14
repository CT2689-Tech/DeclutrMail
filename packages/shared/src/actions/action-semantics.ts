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
