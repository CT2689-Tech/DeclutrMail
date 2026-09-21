/**
 * What is waiting for the user — feeds Home's single button.
 *
 * Both reads reuse the owning feature's query options, so they share a
 * cache entry with `/triage` and the sidebar Screener badge: the count on
 * the button is the count those screens render, and opening Triage from
 * Home paints from the cache.
 *
 * Each is gated on its capability (a locked tier would answer 402) and
 * resolves to `null` when locked or failed — the button then falls
 * through to the next option instead of naming a number nobody read.
 */

import { useQuery } from '@tanstack/react-query';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';

import { useScreenerCount } from '@/features/screener/api/use-screener';
import {
  type TriageBootstrap,
  triageBootstrapQueryOptions,
} from '@/features/triage/api/query-options';
import { apiGet } from '@/lib/api/client';

export interface HomePending {
  triagePending: number | null;
  screenerPending: number | null;
  /** True while an ENABLED read has not answered yet. */
  isLoading: boolean;
}

export function useHomePending(options: { tier: TierId; enabled: boolean }): HomePending {
  const triage = useQuery({
    ...triageBootstrapQueryOptions(async (signal) => {
      const envelope = await apiGet<TriageBootstrap>('/api/triage/bootstrap', { signal });
      return envelope.data;
    }),
    select: (data: TriageBootstrap) => data.queue.length,
    enabled: options.enabled && hasCapability(options.tier, 'triage'),
  });
  const screener = useScreenerCount({
    enabled: options.enabled && hasCapability(options.tier, 'screener'),
  });

  return {
    triagePending: triage.data ?? null,
    screenerPending: screener.data?.pending ?? null,
    isLoading: triage.isLoading || screener.isLoading,
  };
}
