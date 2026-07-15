import type { BillingCycle } from '@declutrmail/shared/contracts';

export type BillingIntent = {
  plan: 'plus' | 'pro';
  cycle: BillingCycle;
  promo?: 'foundingPro';
};

type QueryValue = string | string[] | undefined;

function scalar(value: QueryValue): string | null {
  return typeof value === 'string' ? value : null;
}

/** Validate the only public-to-product checkout intent we accept. */
export function parseBillingIntentParams(params: Record<string, QueryValue>): BillingIntent | null {
  if (Object.keys(params).some((key) => !['plan', 'cycle', 'promo'].includes(key))) return null;
  const plan = scalar(params.plan);
  const cycle = scalar(params.cycle);
  const promo = scalar(params.promo);
  if ((plan !== 'plus' && plan !== 'pro') || (cycle !== 'monthly' && cycle !== 'annual')) {
    return null;
  }
  if (promo !== null && promo !== 'foundingPro') return null;
  if (promo === 'foundingPro' && (plan !== 'pro' || cycle !== 'annual')) return null;
  return {
    plan,
    cycle,
    ...(promo === 'foundingPro' ? { promo } : {}),
  };
}

/** Canonical, local-only path carried through auth and onboarding. */
export function billingIntentPath(intent: BillingIntent): string {
  const query = new URLSearchParams({ plan: intent.plan, cycle: intent.cycle });
  if (intent.promo) query.set('promo', intent.promo);
  return `/billing?${query.toString()}`;
}

/** Parse a complete local path and reject hosts, fragments, and extra keys. */
export function parseBillingIntentPath(value: string | null | undefined): BillingIntent | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('#')) return null;
  let url: URL;
  try {
    url = new URL(value, 'https://declutrmail.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://declutrmail.invalid' || url.pathname !== '/billing') return null;
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !['plan', 'cycle', 'promo'].includes(key))) return null;
  if (new Set(keys).size !== keys.length) return null;
  return parseBillingIntentParams({
    plan: url.searchParams.get('plan') ?? undefined,
    cycle: url.searchParams.get('cycle') ?? undefined,
    promo: url.searchParams.get('promo') ?? undefined,
  });
}
