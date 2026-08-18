/**
 * Hub definitions for the two D132 content clusters.
 *
 * The copy lives here rather than inside the page components because the
 * route's `metadata` and the rendered `<h1>` must state the same thing —
 * they drifted on `/blog` once already, which is what the pinned title
 * assertion in `marketing-metadata.test.ts` exists to catch.
 */

import { ANSWER_ARTICLES, ANSWER_SLUGS } from './answer-content';
import { HOW_TO_ARTICLES, HOW_TO_SLUGS } from './how-to-content';
import type { LearnArticle } from './types';

export interface LearnHubDefinition {
  readonly path: string;
  readonly eyebrow: string;
  /** Rendered as the `<h1>` and reused as the document title. */
  readonly heading: string;
  readonly lead: string;
  readonly description: string;
  /** Short factual chips under the lead; each must be derivable from the data. */
  readonly meta: readonly string[];
  /** Accessible name for the card grid. */
  readonly label: string;
  readonly articles: readonly LearnArticle[];
}

export const HOW_TO_HUB: LearnHubDefinition = {
  path: '/how-to',
  eyebrow: 'Step-by-step · native Gmail first',
  heading: 'Gmail cleanup how-to guides',
  lead: 'Each guide shows the native Gmail method first, states exactly what it changes and what it leaves alone, and cites Google’s own documentation. Where DeclutrMail helps, it is named as one option rather than the only one.',
  description:
    'Step-by-step Gmail guides: delete all emails from one sender, free up storage when Gmail is full, auto archive future mail, stop promotional email, and clean Gmail by sender.',
  meta: [`${HOW_TO_SLUGS.length} guides`, 'Google-sourced steps', 'No affiliate links'],
  label: 'How-to guides',
  articles: HOW_TO_SLUGS.map((slug) => HOW_TO_ARTICLES[slug]),
};

export const ANSWERS_HUB: LearnHubDefinition = {
  path: '/answers',
  eyebrow: 'Straight answers · stated limits',
  heading: 'Answers about Gmail cleanup',
  lead: 'Direct answers to the questions people ask before granting Gmail access — what a cleanup app can see, what each action changes, and where recovery stops. Every answer states its limits instead of rounding them away.',
  description:
    'Direct answers on Gmail cleanup: whether connecting an app is safe, what limited-data analysis means, how undo works, and when to review by sender or email.',
  meta: [`${ANSWER_SLUGS.length} answers`, 'Limits stated, not implied'],
  label: 'Direct answers',
  articles: ANSWER_SLUGS.map((slug) => ANSWER_ARTICLES[slug]),
};
