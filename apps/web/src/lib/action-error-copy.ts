import { apiErrorDisplayId } from '@/lib/api/client';

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
  /** Replaces the clause after the dash. Lowercase, no trailing period. */
  readonly outcome?: string;
}

const CHECK_ACTIVITY = 'check Activity before retrying';
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

  const [lead, outcome] = ((): [string, string] => {
    switch (phase) {
      case 'preview':
        return ["Couldn't load the preview", NOTHING_CHANGED];
      case 'enqueue':
      case 'revert-enqueue':
        return [`Couldn't start ${action}`, NOTHING_CHANGED];
      case 'status':
      case 'revert-status':
        return [`Couldn't confirm ${action}`, CHECK_ACTIVITY];
      case 'terminal':
      case 'revert-terminal':
        return [`${sentenceCase(action)} failed`, CHECK_ACTIVITY];
    }
  })();
  return `${lead} — ${options.outcome ?? outcome}.`;
}

/**
 * D245 — senders an action left alone because they are Protected. One
 * phrase for the pill, the undo line and the click-time toasts, so a skip
 * reads the same wherever it is reported.
 */
export function protectedSkippedCopy(count: number): string {
  return `${count.toLocaleString('en-US')} Protected sender${count === 1 ? '' : 's'} skipped`;
}

/**
 * What an Archive/Later/Delete bulk refused at the click, in the pill's
 * words: "Archive: 1 Protected sender skipped · 1 sender no longer in this
 * mailbox". `null` when it refused nothing. Label bulks refuse for these
 * two reasons only (an Unsubscribe bulk has its own receipt).
 */
export function skippedAtClickCopy(
  verb: string,
  skipped: readonly { reason: string }[],
): string | null {
  const protectedCount = skipped.filter((s) => s.reason === 'protected').length;
  const missing = skipped.filter((s) => s.reason === 'not_found').length;
  const parts = [
    ...(protectedCount > 0 ? [protectedSkippedCopy(protectedCount)] : []),
    ...(missing > 0
      ? [
          `${missing.toLocaleString('en-US')} sender${missing === 1 ? '' : 's'} no longer in this mailbox`,
        ]
      : []),
  ];
  return parts.length > 0 ? `${verb}: ${parts.join(' · ')}` : null;
}

/**
 * `NO_ACTIONABLE_SENDERS` — an Archive/Later/Delete bulk refused every
 * sender at the click. A designed state, not a failure, and the server
 * does not say which reason was whose.
 */
export const NO_ACTIONABLE_SENDERS_COPY =
  'Nothing changed — those senders are Protected or no longer in this mailbox.';

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
