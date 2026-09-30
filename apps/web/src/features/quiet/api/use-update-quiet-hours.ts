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
 * ('quiet')`, reachable on an entitlement downgrade mid-session) is NOT
 * re-toasted here: `upgradeGateHitFrom` (lib/entitlements/upgrade-gate.ts)
 * now recognizes `PRO_FEATURE_REQUIRED` alongside the other three
 * entitlement codes, so the global MutationCache handler already routes it
 * to the UpgradeModal before this hook's own `onError` below runs. Bailing
 * out on any 402 here matches every other capability/quota-gated
 * mutation's `onError` in the app (e.g. `use-noise-archive.ts`) — the
 * modal is the surface, so neither Sentry nor a second toast helps.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@declutrmail/shared';
import {
  parseTimeToMinutes,
  type QuietHoursConfig,
  type QuietHoursState,
} from '@declutrmail/shared/contracts';
import { ApiError } from '@/lib/api/client';
import { putQuietHours } from '@/lib/api/quiet-hours';
import { track } from '@/lib/posthog';
import { captureFeatureException } from '@/lib/sentry';
import { quietKeys } from './query-keys';

export function useUpdateQuietHours(mailboxId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // A background poll (the read's refetchInterval) can already be in
    // flight when a save starts. If it resolves AFTER this save's own
    // `setQueryData` below, its stale (pre-save) data would silently win
    // — the switch flips back, though the server holds the new value.
    // Cancelling first makes TanStack Query discard that fetch's result
    // whenever it lands, regardless of whether the stub itself aborts.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: quietKeys.hours(mailboxId) });
    },
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
      // 402 is the entitlement gate (PRO_FEATURE_REQUIRED for this route) —
      // the global UpgradeModal already explains it, so neither Sentry nor
      // a second toast helps.
      if (err instanceof ApiError && err.status === 402) return;
      captureFeatureException(err, { surface: 'quiet', reason: 'save_hours_failed' });
      toast("Couldn't save quiet hours. Try again.", 'warn');
    },
  });
}
