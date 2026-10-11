'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/client';
import { FirstCleanupNudge } from './first-cleanup-nudge';

export function FirstBacklogNudge() {
  const candidate = useQuery({
    queryKey: ['senders', 'first-backlog'],
    queryFn: async ({ signal }) =>
      (
        await apiGet<{ senderId: string; name: string; inboxEmails: number } | null>(
          '/api/onboarding/backlog',
          { signal },
        )
      ).data,
    staleTime: 30_000,
  });
  if (!candidate.data) return null;
  return (
    <FirstCleanupNudge href={`/senders/${candidate.data.senderId}`} candidate={candidate.data} />
  );
}
