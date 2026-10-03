import { TIER_IDS, type TierId } from '@declutrmail/shared/entitlements';

// Only bounded metadata is added. No address, query, mailbox or user identifier.
let plan: TierId | 'unknown' = 'unknown';
export const ANALYTICS_QA_STORAGE_KEY = 'dm-analytics-qa';

export function setAnalyticsPlan(value: unknown): void {
  plan = TIER_IDS.includes(value as TierId) ? (value as TierId) : 'unknown';
}

/** Read at capture time so an automatic pageview cannot reuse a stale tier. */
export function analyticsContext(): Record<string, string> {
  const rawEnvironment = process.env.NEXT_PUBLIC_TELEMETRY_ENVIRONMENT;
  const environment = ['production', 'preview', 'development', 'test'].includes(
    rawEnvironment ?? '',
  )
    ? rawEnvironment!
    : 'unknown';
  const rawRelease = process.env.NEXT_PUBLIC_SENTRY_RELEASE;
  const release = rawRelease && /^[a-f0-9]{40}$/i.test(rawRelease) ? rawRelease : 'unknown';
  let qa = false;
  try {
    qa =
      typeof window !== 'undefined' &&
      window.localStorage.getItem(ANALYTICS_QA_STORAGE_KEY) === '1';
  } catch {
    // Storage restrictions must not prevent capture or product behavior.
  }
  return {
    telemetry_context_version: '1',
    app_environment: environment,
    app_release: release,
    plan_tier: plan,
    // QA is explicitly self-declared per browser. Everything else is unclassified,
    // not an inferred customer; older events have no context version at all.
    traffic_class: qa ? 'internal_qa' : 'unclassified',
  };
}
