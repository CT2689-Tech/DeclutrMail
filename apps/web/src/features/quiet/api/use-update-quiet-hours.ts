/**
 * `useUpdateQuietHours` — mutation hook for the quiet-hours PUT
 * (U18 — D92/D95). On success the server's post-save state (config +
 * `activeNow`) replaces the cached query directly — no refetch needed,
 * and the "Quiet now" badge updates from the same response the save
 * confirmed.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuietHoursConfig, QuietHoursState } from '@declutrmail/shared/contracts';
import { putQuietHours } from '@/lib/api/quiet-hours';
import { quietKeys } from './query-keys';

export function useUpdateQuietHours(mailboxId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: QuietHoursConfig) => {
      const env = await putQuietHours(mailboxId, config);
      return env.data;
    },
    onSuccess: (state: QuietHoursState) => {
      queryClient.setQueryData(quietKeys.hours(mailboxId), state);
    },
  });
}
