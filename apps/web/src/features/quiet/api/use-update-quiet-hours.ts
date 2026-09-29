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
 * neither Sentry nor the user. The toast names "quiet hours" because
 * it can now surface on whatever screen the user is on by the time it
 * fires.
 *
 * This is the only mutation hook in the app with hook-level toast +
 * Sentry — not yet the convention, a deliberate exception pending the
 * repo-wide unmount-lost-failure sweep (same root cause, ~16 other
 * call sites, tracked as its own follow-up PR).
 *
 * A 402 (`PRO_FEATURE_REQUIRED` — this route is `@RequiresCapability
 * ('quiet')`, reachable on an entitlement downgrade mid-session) is
 * NOT special-cased: `upgradeGateHitFrom` (lib/entitlements/upgrade-
 * gate.ts) only recognizes `FREE_CAP_REACHED` / `INBOX_LIMIT_REACHED`
 * / `ACTION_TIER_REQUIRED`, so the global MutationCache handler does
 * nothing for `PRO_FEATURE_REQUIRED` today — no capability-gated
 * mutation in the app gets an upgrade-modal route for it. Silently
 * dropping the toast here (matching the pattern other 402 codes use)
 * would leave this one failure mode with no signal at all, worse than
 * today. Flagged as a founder follow-up, not fixed here — it's a
 * one-line entitlements-service question, not a Quiet one.
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
      toast("Couldn't save quiet hours. Try again.", 'warn');
    },
  });
}
