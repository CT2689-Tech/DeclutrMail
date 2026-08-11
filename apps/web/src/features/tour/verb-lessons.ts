/**
 * What each of the five verbs does, in one sentence (D38).
 *
 * DERIVED, never authored. Every sentence comes from `ACTION_SEMANTICS`
 * — the D245 canonical behavioural contract whose own docblock says no
 * surface should invent its own current/future semantics. A tooltip
 * that explains an action is exactly the kind of surface that would
 * otherwise drift from what the action actually does.
 *
 * Which sentence: a verb that moves mail is described by what it does
 * to that mail (`currentMail`); a verb that moves none — Keep and
 * Unsubscribe — is described by what it changes instead
 * (`futureMail`), because "no existing email moves" alone never tells
 * anyone what the button is for.
 */

import { ACTION_SEMANTICS, VERB_REGISTRY, type VerbId } from '@declutrmail/shared/actions';

import type { ActionVerb } from '@/features/triage/types';

export interface VerbLesson {
  id: VerbId;
  /** User-facing verb name — K/A/U/L/D labels (D227). */
  label: string;
  /** Single-character shortcut. */
  shortcut: string;
  /** One plain sentence: what this does to the sender's mail. */
  effect: string;
}

export const VERB_LESSONS: readonly VerbLesson[] = VERB_REGISTRY.map((verb) => {
  const semantics = ACTION_SEMANTICS[verb.id];
  return {
    id: verb.id,
    label: verb.label,
    shortcut: verb.shortcut,
    effect:
      semantics.currentMail.scope === 'none'
        ? semantics.futureMail.summary
        : semantics.currentMail.summary,
  };
});

const LESSON_BY_LABEL = new Map<string, VerbLesson>(
  VERB_LESSONS.map((lesson) => [lesson.label, lesson]),
);

/**
 * Lesson for a triage toolbar verb. The triage feature keys verbs by
 * capitalised label (`'Archive'`) while the registry keys them by id
 * (`'archive'`); the labels ARE the registry's own labels, so the
 * lookup is total in practice — it returns `undefined` rather than
 * throwing so a future verb without a lesson renders a plain button
 * instead of crashing the queue.
 */
export function lessonForVerb(verb: ActionVerb): VerbLesson | undefined {
  return LESSON_BY_LABEL.get(verb);
}
