/**
 * `useLogout` — calls `POST /api/auth/logout`, clears local cache,
 * then navigates to the OAuth start endpoint to land the user back
 * on the consent screen ready to sign in again.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api/client';

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await apiPost<{ ok: true }>('/api/auth/logout');
    },
    onSuccess: () => {
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
