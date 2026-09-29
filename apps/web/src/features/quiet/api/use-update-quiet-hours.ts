/**
 * `useUpdateQuietHours` — mutation hook for the quiet-hours PUT
 * (U18 — D92/D95). On success the server's post-save state (config +
 * `activeNow`) replaces the cached query directly — no refetch needed,
 * and the "Quiet now" badge updates from the same response the save
 * confirmed.
 *
 * The success event and the failure signals live HERE, not in the
 * callbacks passed to `mutate()`: those run only while the card is
 * mounted, so a save that failed after the user left the page reached
 * neither Sentry nor the user.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@declutrmail/shared';
import {
  parseTimeToMinutes,
  type QuietHoursConfig,
  type QuietHoursState,
} from '@declutrmail/shared/contracts';
import { putQuietHours } from '@/lib/api/quiet-hours';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';
import { quietKeys } from './query-keys';

export function useUpdateQuietHours(mailboxId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: QuietHoursConfig) => {
      const env = await putQuietHours(mailboxId, config);
      return env.data;
    },
    onSuccess: (state: QuietHoursState, config) => {
      queryClient.setQueryData(quietKeys.hours(mailboxId), state);
      // Server-confirmed save — never optimistic (taxonomy contract).
      void track('quiet_hours_updated', {
        mailbox_id: mailboxId,
        enabled: config.enabled,
        crosses_midnight:
          parseTimeToMinutes(config.startLocal) > parseTimeToMinutes(config.endLocal),
      });
    },
    onError: (err) => {
      captureFeatureException(err, { surface: 'quiet', reason: 'save_hours_failed' });
      toast('Saving failed. Try again.', 'warn');
    },
  });
}
