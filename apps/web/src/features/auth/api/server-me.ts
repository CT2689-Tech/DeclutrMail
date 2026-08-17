import 'server-only';

import { cache } from 'react';

import { serverGet, ServerApiError } from '@/lib/api/server';
import type { Me } from './me-contract';

export const getServerMe = cache(async (cookieHeader: string): Promise<Me | null> => {
  try {
    return await serverGet<Me>('/api/auth/me', cookieHeader);
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 401) {
      return null;
    }

    console.warn(
      '[server-auth] Could not seed the session; falling back to the client auth query.',
      error instanceof Error ? error.message : 'Unknown server auth error',
    );
    return null;
  }
});
