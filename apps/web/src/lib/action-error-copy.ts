/**
 * Plain-language error contract for the asynchronous action pipeline.
 *
 * Every failure names three things in order:
 *   1. what is known to have changed;
 *   2. what is known not to have changed (or is not yet confirmed);
 *   3. the safest next recovery step.
 *
 * Transport messages and identifiers do not belong in `message`. Callers
 * may place `technicalErrorDetails()` inside `<TechnicalDetails>` when a
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

export interface ActionFailureCopy {
  readonly title: string;
  readonly whatChanged: string;
  readonly whatDidNotChange: string;
  readonly nextStep: string;
  readonly message: string;
}

export interface ActionFailureCopyOptions {
  /** Lowercase action phrase, for example "archive Acme". */
  readonly action?: string;
  readonly whatChanged?: string;
  readonly whatDidNotChange?: string;
  readonly nextStep?: string;
}

const DEFAULT_ACTION = 'the action';

export function getActionFailureCopy(
  phase: ActionFailurePhase,
  options: ActionFailureCopyOptions = {},
): ActionFailureCopy {
  const action = options.action ?? DEFAULT_ACTION;
  const defaults: Omit<ActionFailureCopy, 'message'> = (() => {
    switch (phase) {
      case 'preview':
        return {
          title: 'Preview unavailable.',
          whatChanged: 'Nothing changed.',
          whatDidNotChange: 'No mail was moved and no request was sent.',
          nextStep: 'Retry the preview before confirming.',
        };
      case 'enqueue':
        return {
          title: `Couldn't start ${action}.`,
          whatChanged: 'Nothing changed.',
          whatDidNotChange: 'The request was not accepted, so Gmail was not changed.',
          nextStep: 'Try again.',
        };
      case 'status':
        return {
          title: `Couldn't confirm ${action}.`,
          whatChanged: 'The request was accepted, but its outcome is not confirmed.',
          whatDidNotChange: "DeclutrMail hasn't marked it complete.",
          nextStep: 'Check Activity before trying again.',
        };
      case 'terminal':
        return {
          title: `${sentenceCase(action)} failed.`,
          whatChanged: 'The request finished without a confirmed change.',
          whatDidNotChange: "DeclutrMail hasn't marked the action complete.",
          nextStep: 'Check Activity, then try again if needed.',
        };
      case 'revert-enqueue':
        return {
          title: "Couldn't start undo.",
          whatChanged: 'Nothing changed.',
          whatDidNotChange: 'The original action was not reversed.',
          nextStep: 'Try again from Activity.',
        };
      case 'revert-status':
        return {
          title: "Couldn't confirm undo.",
          whatChanged: 'The undo request was accepted, but its outcome is not confirmed.',
          whatDidNotChange: "DeclutrMail hasn't marked the original action as restored.",
          nextStep: 'Check Activity before trying again.',
        };
      case 'revert-terminal':
        return {
          title: 'Undo failed.',
          whatChanged: 'The undo finished without a confirmed restoration.',
          whatDidNotChange: 'The original action was not reversed.',
          nextStep: 'Try again from Activity.',
        };
    }
  })();

  const copy = {
    ...defaults,
    ...(options.whatChanged ? { whatChanged: options.whatChanged } : {}),
    ...(options.whatDidNotChange ? { whatDidNotChange: options.whatDidNotChange } : {}),
    ...(options.nextStep ? { nextStep: options.nextStep } : {}),
  };

  return {
    ...copy,
    message: [copy.title, copy.whatChanged, copy.whatDidNotChange, copy.nextStep].join(' '),
  };
}

/** Extract support-only diagnostics without putting them in primary copy. */
export function technicalErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'No additional diagnostic details were provided.';
}

function sentenceCase(value: string): string {
  return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`;
}
