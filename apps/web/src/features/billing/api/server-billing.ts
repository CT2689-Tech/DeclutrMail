import 'server-only';

import { cache } from 'react';

import { serverGet } from '@/lib/api/server';
import { parseBillingSubscription } from './parse-payload';

/** One request-scoped subscription read shared by the page and invoice stream. */
export const getServerBillingSubscription = cache(async (cookieHeader: string) =>
  parseBillingSubscription(await serverGet<unknown>('/api/billing/subscription', cookieHeader)),
);
