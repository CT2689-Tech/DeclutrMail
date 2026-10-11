import type { ReactNode } from 'react';
import { FIRST_LANDING_SLOT_ORDER } from '../../copy/screen-decisions';

export interface LandingCandidate {
  id: (typeof FIRST_LANDING_SLOT_ORDER)[number];
  ready: boolean;
  node: ReactNode;
}

/** Renders the first ready candidate. An empty list renders nothing. */
export function resolveFirstLanding(candidates: readonly LandingCandidate[]): ReactNode {
  const order = FIRST_LANDING_SLOT_ORDER;
  for (const id of order) {
    const candidate = candidates.find((item) => item.id === id);
    if (candidate?.ready) return candidate.node;
  }
  return null;
}

export function FirstLandingSlot({ candidates }: { candidates: readonly LandingCandidate[] }) {
  return resolveFirstLanding(candidates);
}
