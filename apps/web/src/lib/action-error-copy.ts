import { ApiError, apiErrorDisplayId } from '@/lib/api/client';

/**
 * Plain-language failure copy for the asynchronous action pipeline — one
 * grammar for Triage, the undo tray, Activity and the Brief.
 *
 * One sentence: what is known about the outcome, then (after the dash)
 * what that means for the reader. An accepted request whose outcome is
 * unconfirmed sends them to Activity before retrying, because a blind
 * retry can double-apply; a request that was never accepted says nothing
 * changed.
 *
 * Transport messages and identifiers do not belong here. Callers may
 * place `technicalErrorDetails()` inside `<TechnicalDetails>` when a
 * support reference is useful.
 */
export type ActionFailurePhase =
  | 'preview'
  | 'enqueue'
  | 'status'
  | 'terminal'
  | 'revert-enqueue'
  | 'revert-status'
  | 'revert-terminal';

export interface ActionFailureCopyOptions {
  /** What failed, e.g. "Archive for Acme" or "the Noise archive". Revert phases say "undo". */
  readonly action?: string;
  /** Some of a batch completed — the sentence leads with the confirmed split. */
  readonly partial?: { readonly done: number; readonly total: number; readonly unit: string };
  /**
   * Replaces the clause after the dash. Lowercase, no trailing period.
   * For an enqueue phase it refines "nothing changed", so it is dropped
   * when that is unproven.
   */
  readonly outcome?: string;
  /**
   * The enqueue's failure. An enqueue phase says "nothing changed" only
   * when this proves it (see `enqueueMayHaveStarted`); without it, it
   * says the start is unconfirmed.
   */
  readonly error?: unknown;
}

export const CHECK_ACTIVITY = 'check Activity before retrying';
const NOTHING_CHANGED = 'nothing changed';

export function getActionFailureCopy(
  phase: ActionFailurePhase,
  options: ActionFailureCopyOptions = {},
): string {
  const isRevert = phase.startsWith('revert-');
  const action = isRevert ? 'undo' : (options.action ?? 'the action');

  if (options.partial) {
    const { done, total, unit } = options.partial;
    const split = `${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${unit} completed`;
    const lead = isRevert || !options.action ? split : `${sentenceCase(action)}: ${split}`;
    return `${lead} — ${options.outcome ?? 'check Activity for the rest'}.`;
  }

  const unconfirmedStart =
    (phase === 'enqueue' || phase === 'revert-enqueue') && enqueueMayHaveStarted(options.error);
  const [lead, outcome] = ((): [string, string] => {
    switch (phase) {
      case 'preview':
        return ["Couldn't load the preview", NOTHING_CHANGED];
      // "Can't tell", not "couldn't confirm": right after a Confirm button,
      // "couldn't confirm" reads as "your click did nothing".
      case 'enqueue':
        return unconfirmedStart
          ? [`Can't tell if ${action} started`, CHECK_ACTIVITY]
          : [`Couldn't start ${action}`, NOTHING_CHANGED];
      // An undo request is idempotent (the same token answers with the same
      // reverse job, or "reverted" once it finished), so trying again is
      // always safe — here and after a lost status read below.
      case 'revert-enqueue':
        return unconfirmedStart
          ? ["Can't tell if undo started", 'try again']
          : ["Couldn't start undo", NOTHING_CHANGED];
      case 'status':
        return [`Couldn't confirm ${action}`, CHECK_ACTIVITY];
      case 'revert-status':
        return ["Couldn't confirm undo", 'try again'];
      case 'terminal':
      case 'revert-terminal':
        return [`${sentenceCase(action)} failed`, CHECK_ACTIVITY];
    }
  })();
  return `${lead} — ${unconfirmedStart ? outcome : (options.outcome ?? outcome)}.`;
}

/**
 * An action named in a sentence: "Archive for Acme". "Later" is the verb's
 * name, not an English word — "Couldn't start Later for Acme" reads as
 * "couldn't begin afterwards" — so it says what Later does.
 */
export function actionLabel(verb: string, target: string): string {
  return verb === 'Later' ? `moving email from ${target} to Later` : `${verb} for ${target}`;
}

/** An action past its overdue deadline: a status, not a failure. */
export function stillRunningCopy(verb: string, target: string): string {
  return `${sentenceCase(actionLabel(verb, target))} is still running — see Activity.`;
}

/**
 * Whether a failed enqueue may still have started its job, which leaves
 * "nothing changed" unproven and a blind retry able to run it twice.
 * Only a refusal (4xx) proves the request never started. A 5xx does not:
 * `ENQUEUE_FAILED` means the queue did not confirm the add — a timed-out
 * reply leaves the job running — a bulk answers it when any one add fails
 * while the rest run, and a failure after that write answers 500. With no
 * response at all, nothing says either way.
 */
export function enqueueMayHaveStarted(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/**
 * D245 — senders an action left alone because they are Protected. One
 * phrase for every report of a skip that happened: the pill, its undo
 * line, the Brief's outcome line and the click-time toasts. Previews
 * forecast a skip in their own tense ("is skipped").
 */
export function protectedSkippedCopy(count: number): string {
  return `${count.toLocaleString('en-US')} Protected sender${count === 1 ? '' : 's'} skipped`;
}

/**
 * The one undo-completion toast. Not "restored to your inbox": undo puts
 * each email back where it was, and that is not the inbox for the archived
 * half of an all-mail Delete (ADR-0028) or for an undone restore.
 */
export const UNDO_DONE_TOAST = 'Undone — email is back where it was.';

/** Extract support-only diagnostics without putting them in primary copy. */
export function technicalErrorDetails(error: unknown): string {
  const base = rawErrorMessage(error);
  const displayId = apiErrorDisplayId(error);
  return displayId ? `${base} (Support code: ${displayId})` : base;
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'No additional diagnostic details were provided.';
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
