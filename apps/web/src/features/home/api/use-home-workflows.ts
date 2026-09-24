import { useQuery } from '@tanstack/react-query';
import { hasCapability, type TierId } from '@declutrmail/shared/entitlements';
import { pendingSuggestionsQueryOptions } from '@/features/autopilot/api/query-options';
import { briefTodayQueryOptions } from '@/features/brief/api/query-options';
import { followupsQueryOptions } from '@/features/followups/api/query-options';
import { fetchPendingSuggestions } from '@/lib/api/autopilot';
import { fetchBriefToday } from '@/lib/api/brief';
import { fetchFollowups } from '@/lib/api/followups';

/** Optional Home signals reuse the destination screens' cache entries. A failed
 * read never blocks the main cleanup action or invents a zero count. */
export function useHomeWorkflows(tier: TierId, enabled: boolean) {
  const brief = useQuery({
    ...briefTodayQueryOptions((signal) => fetchBriefToday(signal)),
    enabled: enabled && hasCapability(tier, 'brief'),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });
  const followups = useQuery({
    ...followupsQueryOptions((signal) => fetchFollowups(signal)),
    enabled: enabled && hasCapability(tier, 'followups'),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });
  const suggestions = useQuery({
    ...pendingSuggestionsQueryOptions((signal) =>
      fetchPendingSuggestions(signal).then((envelope) => envelope.data),
    ),
    enabled: enabled && hasCapability(tier, 'autopilot'),
    retry: false,
    staleTime: 2 * 60 * 1000,
  });

  return {
    brief: brief.data
      ? {
          ready: true,
          opened: brief.data.data.openedAt !== null,
          replyCount:
            brief.data.data.briefPayload.replyTotal ?? brief.data.data.briefPayload.reply.length,
        }
      : null,
    followups: followups.data
      ? followups.data.data.filter(
          (row) => row.status === 'awaiting' && row.feedbackRating !== 'not_followup',
        ).length
      : null,
    suggestions: suggestions.data?.length ?? null,
  };
}

export type HomeWorkflows = ReturnType<typeof useHomeWorkflows>;
