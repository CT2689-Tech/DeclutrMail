'use client';

import dynamic from 'next/dynamic';
import { useUpgradeGateStore } from '@/lib/entitlements/upgrade-gate';

const UpgradeModal = dynamic(
  () => import('./upgrade-modal').then((module) => module.UpgradeModal),
  { ssr: false, loading: () => <span role="status">Loading upgrade options…</span> },
);

/** A hidden upgrade dialog must not be part of every screen's initial JavaScript. */
export function UpgradeModalHost() {
  const hit = useUpgradeGateStore((state) => state.hit);
  return hit ? <UpgradeModal /> : null;
}
