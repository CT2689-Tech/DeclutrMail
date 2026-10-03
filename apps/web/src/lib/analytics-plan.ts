import { TIER_IDS, type TierId } from '@declutrmail/shared/entitlements';

// A small synchronous seam shared with the consent-lazy capture context.
// Logout/account switching clears this even when analytics is unavailable.
let plan: TierId | 'unknown' = 'unknown';

export function setAnalyticsPlan(value: unknown): void {
  plan = TIER_IDS.includes(value as TierId) ? (value as TierId) : 'unknown';
}

export function analyticsPlan(): TierId | 'unknown' {
  return plan;
}
