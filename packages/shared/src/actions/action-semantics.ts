import type { ActionJobStatus } from '../contracts/action-job-status';
import type { ActionVerb } from '../contracts/verb-constants';
import { UNIFORM_UNDO_WINDOW_DAYS } from '../entitlements/undo-window';
import type { UnsubscribeCapability } from './unsubscribe-capability';

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

/**
 * The scope-limit claims an action can make about what it does NOT do.
 *
 * Keyed rather than free text because these facts are only true RELATIVE
 * to the action being described. Archive truthfully says "The sender is
 * not unsubscribed."; rendered verbatim under an Unsubscribe primary the
 * same sentence is a lie. A composite preview has to be able to ask
 * "does the primary contradict this claim?", and it cannot ask that of a
 * string (founder screenshot review 2026-08-27 — it shipped, and every
 * fact in it was individually true).
 */
export type UnchangedClaim =
  | 'nothing-deleted'
  | 'not-unsubscribed'
  | 'not-subscribed-or-unsubscribed'
  | 'labels-unchanged'
  | 'not-protected';

export interface UnchangedFact {
  readonly claim: UnchangedClaim;
  readonly summary: string;
}

export interface ActionSemantics {
  readonly verb: ActionVerb;
  readonly label: string;
  readonly currentMail: {
    readonly scope: CurrentMailScope;
    readonly destination: CurrentMailDestination;
    readonly summary: string;
    /**
     * Used instead of `summary` when this action is previewed WITH a
     * secondary action. Unsubscribe's standalone summary hedges ("unless
     * you choose a separate action for it"); once the reader has chosen
     * one, that clause is stale and reads as an unanswered condition.
     */
    readonly compositeSummary?: string;
  };
  readonly futureMail: {
    readonly effect: FutureMailEffect;
    readonly summary: string;
  };
  readonly unchanged: readonly UnchangedFact[];
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
      // Names the ONE consequence Keep actually has. The previous line —
      // "DeclutrMail remembers Keep as your decision for this sender." —
      // stated a memory without a consequence, and a reader reasonably
      // heard "this sender is safe now".
      //
      // What Keep really writes (traced live on the dev mailbox
      // 2026-08-27): an `activity_log` row with `affected_count = 0`,
      // which is what drops the sender out of the Triage queue, and
      // `sender_policies.policy_type='keep'`, which NO reader anywhere
      // filters on. It does NOT rewrite `triage_decisions.verdict` —
      // that row still read `verdict='unsubscribe'` immediately after a
      // Keep — so even the verdict-gated Autopilot presets keep matching.
      summary:
        'This sender stops coming up in Triage. Future email arrives exactly as it does now.',
    },
    unchanged: [
      { claim: 'labels-unchanged', summary: 'Gmail labels and delivery settings are unchanged.' },
      {
        claim: 'not-protected',
        // Verified against the executors, not assumed:
        // `autopilot-apply.worker.ts` reduces its candidate set with
        // `signalRows.filter((s) => !s.signals.isProtected)` and nothing
        // else, `autopilot-action.worker.ts` shields on `isProtected`
        // alone, and the Brief's noise group does the same
        // (`brief.read-service.ts`). Since Keep leaves the triage verdict
        // untouched, no preset is gated out either. Protect is the only
        // state that stops them — D245's "Protected is the sole visible
        // safety state".
        summary: 'Keep is not Protect — Autopilot rules can still act on this sender.',
      },
    ],
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
    unchanged: [
      { claim: 'nothing-deleted', summary: 'Nothing is deleted.' },
      { claim: 'not-unsubscribed', summary: 'The sender is not unsubscribed.' },
    ],
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
    unchanged: [
      { claim: 'nothing-deleted', summary: 'Nothing is deleted.' },
      { claim: 'not-unsubscribed', summary: 'The sender is not unsubscribed.' },
    ],
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
      summary: 'Activity Undo or the scheduled return restores the email to Inbox.',
    },
    resultLabel: 'Moved to Later',
  },
  unsubscribe: {
    verb: 'unsubscribe',
    label: 'Unsubscribe',
    currentMail: {
      scope: 'none',
      destination: 'unchanged',
      summary: 'Existing email stays where it is unless you choose a separate action for it.',
      compositeSummary: 'Unsubscribing on its own moves no existing email.',
    },
    futureMail: {
      effect: 'unsubscribe-request',
      summary:
        'DeclutrMail sends a supported one-click request, or opens a prefilled Gmail draft for you to send.',
    },
    // Intentionally empty: the only fact here restated `currentMail` and
    // rendered immediately after it in every preview.
    unchanged: [],
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
    unchanged: [
      { claim: 'nothing-deleted', summary: 'Nothing is deleted.' },
      {
        claim: 'not-subscribed-or-unsubscribed',
        summary: 'The sender is not subscribed or unsubscribed.',
      },
    ],
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
    unchanged: [{ claim: 'not-unsubscribed', summary: 'The sender is not unsubscribed.' }],
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
  // D245 fix: this static path was reading `activityUndo.summary` raw,
  // which meant it never got the "state the window instead of hedging"
  // derivation `presentationActivityUndo` already applies below. No
  // specific action is behind static copy, so there is no deadline to
  // pass — only the uniform-window derivation applies.
  const activityUndoSummaryText =
    semantics.activityUndo.kind === 'none'
      ? semantics.activityUndo.summary
      : activityUndoSummary(UNIFORM_UNDO_WINDOW_DAYS, null, semantics.activityUndo.summary);
  const recovery = [activityUndoSummaryText];
  if (semantics.providerRecovery.kind !== 'none') {
    recovery.push(semantics.providerRecovery.summary);
  }
  // Only `provider-permanent-deletion` adds a fact beyond `activityUndo`.
  // `delivered-request-cannot-be-recalled` restates it, and both rendered
  // back-to-back in the same paragraph.
  if (semantics.finality.kind === 'provider-permanent-deletion') {
    recovery.push(semantics.finality.summary);
  }
  return [
    semantics.currentMail.summary,
    semantics.futureMail.summary,
    ...semantics.unchanged.map((fact) => fact.summary),
    ...recovery,
  ].join(' ');
}

/**
 * The recovery/finality sentences a confirm surface should show, in order.
 *
 * Two rules the surfaces kept getting wrong independently:
 *
 *  1. **Say each fact once.** `finality` restates `activityUndo` for every
 *     kind except `provider-permanent-deletion`, where it adds Gmail's
 *     retention. The senders modal emitted both, so an Unsubscribe preview
 *     read "A delivered unsubscribe request cannot be undone. After
 *     delivery, the unsubscribe request cannot be recalled." — one fact,
 *     two spellings, and then the footer printed the pair again.
 *  2. **Say which action each fact belongs to.** A composite put "cannot
 *     be undone" (unsubscribe) next to "Undo from Activity" (archive) with
 *     nothing tying either sentence to its verb, so the block read as a
 *     contradiction. Labels appear ONLY when there are two actions —
 *     labelling a single action is noise.
 */
export function composeRecoveryFacts(
  primary: PresentedAction,
  secondary: PresentedAction | null,
): readonly string[] {
  const factsFor = (action: PresentedAction): readonly string[] => [
    action.activityUndo.summary,
    ...(action.providerRecovery.kind === 'none' ? [] : [action.providerRecovery.summary]),
    // Only `provider-permanent-deletion` carries a fact `activityUndo`
    // does not already state. Mirrors `staticActionPreviewCopy`.
    ...(action.finality.kind === 'provider-permanent-deletion' ? [action.finality.summary] : []),
  ];

  if (secondary === null) {
    return [...new Set(factsFor(primary))];
  }
  const primaryFacts = factsFor(primary);
  const secondaryFacts = factsFor(secondary).filter((fact) => !primaryFacts.includes(fact));
  if (secondaryFacts.length === 0) {
    return [...new Set(primaryFacts)];
  }
  return [
    `${primary.label} — ${primaryFacts.join(' ')}`,
    `${secondary.label} — ${secondaryFacts.join(' ')}`,
  ];
}

export function actionHasRecovery(verb: ActionVerb): boolean {
  const semantics = ACTION_SEMANTICS[verb];
  return (
    semantics.finality.kind === 'reversible-or-changeable' ||
    semantics.activityUndo.kind !== 'none' ||
    semantics.providerRecovery.kind !== 'none'
  );
}

/**
 * Inbox depth at which a Later preview says the returning mail arrives
 * together.
 *
 * Later is the only mail-moving verb with no way to narrow its reach — it
 * takes every inbox message from the sender — and it is also the only one
 * that hands all of it back at once, on a date chosen when the pile was
 * out of sight. The preview already states the count and the return date
 * in separate sentences; at scale the reader has to join them to see what
 * is coming.
 *
 * 200 is anchored on the reference mailbox, not chosen for roundness:
 * 6,781 senders hold inbox mail, p95 is 28 and p99 is 152, so 200 sits
 * just above the 99th percentile and fires for 53 senders (0.8%). A
 * notice that fires on the median is noise; one that fires for the six
 * senders above 1,000 is decoration.
 *
 * Founder decision 2026-08-27 (option 3B) — a beat before confirming,
 * deliberately NOT a gate: Later returns the mail on a date the user
 * picked and Activity can reverse it, so friction here would tax the one
 * mail-moving verb that undoes itself.
 *
 * The sentence says only what the system actually guarantees, which took
 * two corrections to arrive at.
 *
 * It carries NO count. The first draft read "All 1,718 arrive back
 * together." — a definite quantity, asserted at confirm time, about an
 * event weeks away. The preview one line above already disclaims that
 * very number ("Rechecked when it runs, so the final count can differ
 * from this preview"), and between the move and the wake date an Activity
 * undo or any other action changes what is left to come back.
 *
 * It also makes NO claim that the mail arrives all at once. The second
 * draft read "They all return together, not spread out.", which the wake
 * pipeline cannot promise: `GmailClientService.batchModify` chunks at
 * 1,000 ids into SEQUENTIAL requests through the rate limiter, and
 * `SnoozeWakeWorker.wakeSender` updates the local mirror only after the
 * whole call returns. So on a wake above 1,000 messages — precisely the
 * size this notice exists for — a failure on the second chunk leaves the
 * first already back in the Inbox and the remainder landing after a
 * BullMQ backoff. Spread out, exactly.
 *
 * What IS guaranteed is the SCHEDULE, not the delivery:
 * `sender_policies.snoozed_until` is one timestamp per sender, so every
 * message carrying the Later label shares one return time. That is the
 * fact the reader needs — the pile has a single date, it does not
 * trickle back over days — and it stays true however many requests the
 * restore takes.
 */
export const LATER_BULK_RETURN_NOTICE_THRESHOLD = 200;

/** D245 default Later preset used by every producer unless the user picks another time. */
export const DEFAULT_LATER_WAKE_DAYS = 7;

export function defaultLaterWakeAtIso(now = new Date()): string {
  return new Date(now.getTime() + DEFAULT_LATER_WAKE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The unsubscribe capabilities a sender can be in — including `unknown`
 * for a sender the index has not derived a method for yet (D248). Alias
 * of `UnsubscribeCapability` so presentation and partition share ONE
 * vocabulary and cannot drift.
 */
export type UnsubscribeChannel = UnsubscribeCapability;

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
  /**
   * Which clock absolute times are printed in.
   *
   * `'utc'` (the default) keeps every existing caller and any
   * server-rendered path deterministic. `'viewer'` renders in the
   * reader's own zone and is what interactive confirm surfaces pass:
   * the Later sheet's `<input type="datetime-local">` is inherently
   * local, so a UTC summary beside it showed the same instant twice in
   * two clocks — "Returns to Inbox Sep 3, 2026 at 8:01 AM UTC" above a
   * picker reading "09/03/2026, 01:01 AM" (founder screenshot
   * 2026-08-27). Same defect on the Undo deadline.
   */
  readonly timeZone?: PresentationTimeZone;
}

export type PresentationTimeZone = 'utc' | 'viewer';

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
      readonly kind: UnsubscribeChannel;
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
  /**
   * Set only for a scheduled Later whose reach crosses
   * {@link LATER_BULK_RETURN_NOTICE_THRESHOLD} — the sentence naming that
   * all of it comes back at once. Surfaces may style it; it is ALSO part
   * of `effectCopy`/`previewCopy`, so a surface that renders either gets
   * it with no wiring of its own.
   */
  readonly bulkReturnNotice: string | null;
  /**
   * `previewCopy` WITHOUT the recovery sentences — what the action does,
   * for surfaces that render recovery in their own slot (the senders
   * modal's ⏱ callout).
   *
   * It exists because that modal used to hand-assemble the same list
   * from the raw `currentMail` / `futureMail` / `unchanged` fields, which
   * meant composite suppression applied to `previewCopy` and silently
   * did not apply to the lead paragraph the reader actually saw.
   */
  readonly effectCopy: string;
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
    timeZone: input.timeZone ?? 'utc',
    hasSecondary: input.secondaryAction != null,
  });
  const secondary = input.secondaryAction
    ? presentAction({
        verb: input.secondaryAction.verb,
        liveCount: input.secondaryAction.liveCount,
        planUndoDeadline: input.planUndoDeadline,
        wakeAt: input.wakeAt,
        unsubscribeChannel: input.unsubscribeChannel,
        timeZone: input.timeZone ?? 'utc',
        composedUnder: ACTION_SEMANTICS[input.verb],
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
  /**
   * Set only when this action is the SECONDARY half of a composite. The
   * primary's semantics decide which of this action's standalone facts
   * survive — see {@link secondaryFactsUnder}.
   */
  readonly timeZone: PresentationTimeZone;
  readonly composedUnder?: ActionSemantics | null;
  /**
   * Set only on the PRIMARY of a composite, so its standalone hedge can
   * give way to `currentMail.compositeSummary`.
   */
  readonly hasSecondary?: boolean;
}

/**
 * Which of a secondary action's scope-limit claims survive beside a
 * given primary.
 *
 * Two rules, both learned from one shipped screen:
 *
 *  1. The primary owns the future-mail story. Archive's "Future email is
 *     unchanged." rendered one sentence after "DeclutrMail sends a
 *     supported one-click unsubscribe request." — a flat contradiction.
 *     When the primary and secondary disagree the secondary is wrong;
 *     when they agree the line is noise. Dropped either way.
 *  2. A claim the primary contradicts is dropped. Archive's
 *     `not-unsubscribed` is true alone and false under an unsubscribe.
 */
function secondaryFactsUnder(
  secondary: ActionSemantics,
  primary: ActionSemantics,
): { readonly futureMail: string | null; readonly unchanged: readonly UnchangedFact[] } {
  const primaryUnsubscribes = primary.futureMail.effect === 'unsubscribe-request';
  return {
    futureMail: null,
    unchanged: secondary.unchanged.filter((fact) => {
      if (!primaryUnsubscribes) return true;
      return fact.claim !== 'not-unsubscribed' && fact.claim !== 'not-subscribed-or-unsubscribed';
    }),
  };
}

function presentAction(input: PresentActionInput): PresentedAction {
  if (input.liveCount !== null) {
    assertLiveCount(input.liveCount);
  }
  const semantics = ACTION_SEMANTICS[input.verb];
  const countSummary =
    input.liveCount === null ? null : presentationCountSummary(input.verb, input.liveCount);
  const schedule = presentationSchedule(semantics, input.wakeAt, input.timeZone);
  const activityUndo = presentationActivityUndo(semantics, input.planUndoDeadline, input.timeZone);
  const unsubscribeChannel = presentationUnsubscribeChannel(input.verb, input.unsubscribeChannel);
  const composedUnder = input.composedUnder ?? null;
  const currentMail =
    input.hasSecondary === true && semantics.currentMail.compositeSummary !== undefined
      ? { ...semantics.currentMail, summary: semantics.currentMail.compositeSummary }
      : semantics.currentMail;
  const surviving = composedUnder === null ? null : secondaryFactsUnder(semantics, composedUnder);
  const futureMailSummary =
    unsubscribeChannel.kind === 'not-applicable'
      ? semantics.futureMail.summary
      : unsubscribeChannel.summary;
  const presentedFutureMail = surviving === null ? futureMailSummary : surviving.futureMail;
  const presentedUnchanged = surviving === null ? semantics.unchanged : surviving.unchanged;
  // No count: `liveCount` is a presented field in its own right and every
  // surface using `effectCopy` renders the figure itself, so including it
  // here would print the number twice.
  // Deliberately in the SHARED builder rather than in each sheet: four
  // surfaces can confirm a Later, and every one of them renders either
  // `previewCopy` or `effectCopy`, so folding the sentence in here reaches
  // all four with no call site left to forget (2026-08-27 — a prop added
  // to one sheet and never passed by its screen shipped exactly that way).
  const bulkReturnNotice =
    input.verb === 'later' &&
    schedule.kind === 'scheduled' &&
    input.liveCount !== null &&
    input.liveCount >= LATER_BULK_RETURN_NOTICE_THRESHOLD
      ? 'All of them share that one return time.'
      : null;
  const effectFacts = [
    currentMail.summary,
    ...(presentedFutureMail === null ? [] : [presentedFutureMail]),
    ...presentedUnchanged.map((fact) => fact.summary),
    ...(schedule.kind === 'none' ? [] : [schedule.summary]),
    ...(bulkReturnNotice === null ? [] : [bulkReturnNotice]),
  ];
  const facts = [
    ...(countSummary === null ? [] : [countSummary]),
    ...effectFacts,
    activityUndo.summary,
    ...(semantics.providerRecovery.kind === 'none' ? [] : [semantics.providerRecovery.summary]),
    ...(semantics.finality.kind === 'provider-permanent-deletion'
      ? [semantics.finality.summary]
      : []),
  ];

  return {
    verb: input.verb,
    label: semantics.label,
    resultLabel: semantics.resultLabel,
    liveCount: input.liveCount,
    currentMail,
    futureMail: semantics.futureMail,
    unchanged: presentedUnchanged.map((fact) => fact.summary),
    schedule,
    activityUndo,
    unsubscribeChannel,
    providerRecovery: semantics.providerRecovery,
    finality: semantics.finality,
    bulkReturnNotice,
    facts,
    previewCopy: facts.join(' '),
    effectCopy: effectFacts.join(' '),
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
  timeZone: PresentationTimeZone,
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
    summary: `Returns to Inbox ${formatPresentationDateTime(wakeAt, timeZone)}.`,
  };
}

function presentationActivityUndo(
  semantics: ActionSemantics,
  deadline: string | null,
  timeZone: PresentationTimeZone,
): ActionPresentationActivityUndo {
  if (semantics.activityUndo.kind === 'none') {
    return { kind: 'none', deadline: null, summary: semantics.activityUndo.summary };
  }
  return {
    kind: 'plan-window',
    deadline,
    summary: activityUndoSummary(
      UNIFORM_UNDO_WINDOW_DAYS,
      deadline,
      semantics.activityUndo.summary,
      timeZone,
    ),
  };
}

/**
 * Chooses the Activity Undo summary line for an action that supports it.
 * Pure and parameterized on the window (rather than reading
 * `UNIFORM_UNDO_WINDOW_DAYS` itself) so the divergent-ladder fallback can
 * be driven directly in tests without editing `pricing.config.ts`.
 */
export function activityUndoSummary(
  uniformWindowDays: number | null,
  deadline: string | null,
  planDependentFallback: string,
  /**
   * Which clock an absolute deadline prints in. Defaults to `'utc'` so
   * `staticActionPreviewCopy` and every existing caller are unchanged;
   * interactive previews pass `'viewer'` so this line and the Later
   * sheet's own `datetime-local` picker read the same wall clock.
   */
  timeZone: PresentationTimeZone = 'utc',
): string {
  // A real deadline always wins — it is the exact answer for THIS action.
  if (deadline !== null) {
    return `Undo from Activity until ${formatPresentationDateTime(deadline, timeZone)}.`;
  }
  // No deadline yet (every preview, before the mutation runs). While the
  // ladder is uniform we can still state the window instead of hedging.
  if (uniformWindowDays !== null) {
    return `Undo from Activity for ${uniformWindowDays} days.`;
  }
  // Ladder has diverged; the plan-dependent wording is the honest one.
  return planDependentFallback;
}

/** Stable display copy until surfaces provide mailbox-timezone formatting. */
/**
 * Renders an instant for a preview.
 *
 * `'viewer'` uses the runtime's own zone and appends its short name, so
 * the sentence and a `datetime-local` picker beside it read the same
 * wall clock. Only interactive client surfaces ask for it — everything
 * server-rendered or static stays on `'utc'`, which is deterministic.
 */
function formatPresentationDateTime(value: string, timeZone: PresentationTimeZone): string {
  if (timeZone === 'utc') return formatIsoUtc(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Action presentation dates must be valid ISO date-time strings.');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
  // "Sep 3, 2026 at 1:01 AM PDT" — Intl gives "Sep 3, 2026, 1:01 AM PDT".
  return parts.replace(/,\s(?=\d{1,2}:\d{2}\s)/, ' at ');
}

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
  // D248: a caller with no channel fact is in the SAME state as a sender
  // the index has not derived one for — unknown. It is never `none`.
  switch (channel ?? 'unknown') {
    case 'one_click':
      return {
        kind: 'one_click',
        summary: 'DeclutrMail sends a supported one-click unsubscribe request.',
      };
    case 'mailto':
      return {
        kind: 'mailto',
        summary: 'DeclutrMail opens a prefilled Gmail draft; you send it.',
      };
    case 'none':
      return { kind: 'none', summary: 'No supported unsubscribe channel is available.' };
    case 'unknown':
      return {
        kind: 'unknown',
        summary: 'This sender has not been checked for an unsubscribe option yet.',
      };
  }
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
