/**
 * Guides to surface beside a comparison or alternatives page.
 *
 * Kept out of `comparison-data.ts` so competitor facts never import
 * learn content. Labels and descriptions are the target page's own
 * title and description, so this file does not invent copy.
 */

import { ANSWER_ARTICLES, type AnswerSlug } from '../learn/answer-content';
import { HOW_TO_ARTICLES, type HowToSlug } from '../learn/how-to-content';
import type { RelatedLink } from '../learn/types';
import type { ComparisonSlug } from './comparison-data';

function howTo(slug: HowToSlug): RelatedLink {
  const article = HOW_TO_ARTICLES[slug];
  return { href: article.path, label: article.title, description: article.description };
}

function answer(slug: AnswerSlug): RelatedLink {
  const article = ANSWER_ARTICLES[slug];
  return { href: article.path, label: article.title, description: article.description };
}

export const COMPARISON_RELATED_GUIDES: Record<ComparisonSlug, readonly RelatedLink[]> = {
  'clean-email': [
    howTo('clean-gmail-by-sender'),
    howTo('bulk-delete-emails-from-one-sender'),
    howTo('gmail-storage-full'),
  ],
  trimbox: [
    howTo('unsubscribe-from-emails-gmail'),
    howTo('stop-promotional-emails-gmail'),
    howTo('bulk-delete-emails-from-one-sender'),
  ],
  sanebox: [
    howTo('auto-archive-future-emails-in-gmail'),
    howTo('clean-gmail-by-sender'),
    answer('sender-level-vs-message-level-cleanup'),
  ],
  'leave-me-alone': [
    howTo('unsubscribe-from-emails-gmail'),
    howTo('stop-promotional-emails-gmail'),
    howTo('clean-gmail-by-sender'),
  ],
  'unroll-me': [
    howTo('unsubscribe-from-emails-gmail'),
    answer('is-it-safe-to-connect-gmail-app'),
    howTo('stop-promotional-emails-gmail'),
  ],
  'gmail-filters': [
    howTo('auto-archive-future-emails-in-gmail'),
    howTo('bulk-delete-emails-from-one-sender'),
    howTo('stop-promotional-emails-gmail'),
  ],
  gmail: [
    howTo('unsubscribe-from-emails-gmail'),
    howTo('bulk-delete-emails-from-one-sender'),
    howTo('gmail-storage-full'),
  ],
  'meta-muse': [
    answer('is-it-safe-to-connect-gmail-app'),
    answer('what-is-metadata-only-email-analysis'),
    howTo('clean-gmail-by-sender'),
  ],
};

/** Native Gmail guides linked from the /compare index, after the tool lists. */
export const COMPARE_DIY_GUIDES: readonly RelatedLink[] = [
  howTo('clean-gmail-by-sender'),
  howTo('bulk-delete-emails-from-one-sender'),
  howTo('auto-archive-future-emails-in-gmail'),
  howTo('unsubscribe-from-emails-gmail'),
  howTo('stop-promotional-emails-gmail'),
];
