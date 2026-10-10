/**
 * `useLogout` — calls `POST /api/auth/logout`, clears local cache,
 * then opens sign-in with a clear signed-out confirmation.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, redirectAfterLogout } from '@/lib/api/client';
import { resetIdentity } from '@/lib/posthog';

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiPost<{ ok: true }>('/api/auth/logout');
    },
    onSuccess: () => {
      // Prevent the next person using a shared browser from inheriting the
      // previous internal analytics identity. Analytics is best-effort:
      // an optional SDK load failure must never block cache clearing or
      // navigation after the server session has already ended.
      void resetIdentity().catch(() => undefined);
      // Clearing mounted queries can start unauthorized reads. Reserve
      // the signed-out destination first so their 401 cannot replace it.
      redirectAfterLogout();
      qc.clear();
    },
  });
}
