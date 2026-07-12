/**
 * `useLogout` — calls `POST /api/auth/logout`, clears local cache,
 * then navigates to the OAuth start endpoint to land the user back
 * on the consent screen ready to sign in again.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api/client';
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
      qc.clear();
      if (typeof window !== 'undefined') {
        // Bounce to the root — AuthProvider on the landing surface
        // will then trigger the consent redirect when the user
        // chooses to sign back in.
        window.location.assign('/');
      }
    },
  });
}
