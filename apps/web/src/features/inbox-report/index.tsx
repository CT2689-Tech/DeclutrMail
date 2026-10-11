'use client';

import type { JSX } from 'react';

import type { HomeFixCandidate } from '@/features/home/home-next-steps';

/**
 * WS5 replaces this module.
 * The shipped card root must render `data-inbox-report` so Home hides
 * the deck fallback underneath it. `getFixSet` is the suggested-step source.
 */
export function InboxReportCard(_props: { surface: 'home' | 'senders' }): JSX.Element | null {
  return null;
}

export function getFixSet(): readonly HomeFixCandidate[] {
  return [];
}
