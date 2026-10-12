import type { ReactNode } from 'react';

export const BANNER_SLOT_ORDER = ['deletion_grace', 'past_due', 'reconnect', 'sync_error'] as const;

export type BannerSlotId = (typeof BANNER_SLOT_ORDER)[number];

export interface BannerCandidate {
  id: BannerSlotId;
  ready: boolean;
  node: ReactNode;
}

/** Chrome banners, highest priority first. Cookie consent is not in this slot. */
export function resolveBanner(candidates: readonly BannerCandidate[]): ReactNode {
  for (const id of BANNER_SLOT_ORDER) {
    const candidate = candidates.find((item) => item.id === id);
    if (candidate?.ready) return candidate.node;
  }
  return null;
}

export function BannerSlot({ candidates }: { candidates: readonly BannerCandidate[] }) {
  return resolveBanner(candidates);
}
