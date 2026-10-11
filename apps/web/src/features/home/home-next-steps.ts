import type { HomeState } from './home-state';

/** Closed set for `home_next_step_clicked`. Order is the card rank. */
export const HOME_NEXT_STEP_KINDS = ['unsub_archive', 'largest', 'later_due'] as const;

export type HomeNextStepKind = (typeof HOME_NEXT_STEP_KINDS)[number];

export interface HomeFixCandidate {
  kind: HomeNextStepKind;
  senderCount: number;
  emailCount?: number;
  sizeLabel?: string;
  senderIds: readonly string[];
  senderName?: string;
}

export type HomeV1Mode = 'full' | 'fallback' | 'empty' | 'sync-failed' | 'loading' | 'error';

const RANK = new Map<HomeNextStepKind, number>(
  HOME_NEXT_STEP_KINDS.map((kind, index) => [kind, index]),
);

/**
 * 1 primary + up to 2 secondary. Largest is omitted until F2's size view
 * is on. A zero sender count is not a card.
 */
export function rankHomeNextSteps(
  candidates: readonly HomeFixCandidate[],
  options: { senderSizeView: boolean },
): HomeFixCandidate[] {
  return candidates
    .filter((candidate) => candidate.senderCount > 0)
    .filter((candidate) => options.senderSizeView || candidate.kind !== 'largest')
    .slice()
    .sort((a, b) => (RANK.get(a.kind) ?? 99) - (RANK.get(b.kind) ?? 99))
    .slice(0, 3);
}

export function homeV1Mode(kind: HomeState['kind'], stepCount: number): HomeV1Mode {
  switch (kind) {
    case 'loading':
    case 'error':
    case 'empty':
    case 'sync-failed':
      return kind;
    case 'ready':
      return stepCount > 0 ? 'full' : 'fallback';
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/** "Review N today" is never Home's primary action. */
export function isRetiredReviewCta(label: string): boolean {
  return /^Review [\d,]+ (today|new)$/.test(label);
}
