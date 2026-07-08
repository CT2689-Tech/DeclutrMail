/**
 * Saved sender filter views (D51) — the FE side of:
 *
 *   - GET   /api/me/settings       — carries `senderViews` (read via the
 *     shared settings query so the Views menu costs no extra request).
 *   - PATCH /api/me/sender-views   — full-replace set-state write.
 *
 * USER-scoped like the rest of the settings family: views roam
 * mailboxes (a view is a scope recipe, not mailbox rows).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MeSettings, SavedSenderView } from '@declutrmail/shared/contracts';

import { apiPatch } from '@/lib/api/client';
import { ME_SETTINGS_QUERY_KEY, useMeSettings } from '@/features/settings/api/use-me-settings';

/** Read the saved views (empty array while the settings query loads). */
export function useSenderViews(): SavedSenderView[] {
  const settings = useMeSettings();
  return settings.data?.senderViews ?? [];
}

/**
 * PATCH /api/me/sender-views — the ONE mutation for save / delete
 * (full-replace list ≤ 10). Folds the server echo back into the shared
 * settings cache so the menu reflects the write without a refetch.
 */
export function useSaveSenderViews() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (views: SavedSenderView[]): Promise<SavedSenderView[]> => {
      const env = await apiPatch<{ senderViews: SavedSenderView[] }>('/api/me/sender-views', {
        views,
      });
      return env.data.senderViews;
    },
    onSuccess: (senderViews) => {
      qc.setQueryData<MeSettings>(ME_SETTINGS_QUERY_KEY, (prev) =>
        prev ? { ...prev, senderViews } : prev,
      );
    },
  });
}
