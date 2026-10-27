import 'server-only';

import { cache } from 'react';

import { serverGet } from '@/lib/api/server';
import { parseBillingSubscription } from './parse-payload';

/** Request-scoped current-plan read; historical payments have a separate endpoint. */
export const getServerBillingSubscription = cache(async (cookieHeader: string) =>
  parseBillingSubscription(await serverGet<unknown>('/api/billing/subscription', cookieHeader)),
);
