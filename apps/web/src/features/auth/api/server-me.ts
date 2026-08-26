import 'server-only';

import { cache } from 'react';

import { serverGet, ServerApiError } from '@/lib/api/server';
import type { Me } from './me-contract';

const ACCESS_COOKIE = 'dm_access';

/**
 * Cheap eligibility check for speculative route hydration.
 *
 * This deliberately does not treat the cookie as authentication: every API
 * request still runs JwtGuard and the mailbox guard. It only lets a route
 * start that already-protected request without first serially calling
 * `/api/auth/me`. Invalid or expired cookies remain designed 401 fallbacks.
 */
export function hasServerAccessCookie(cookieHeader: string): boolean {
  return cookieHeader.split(';').some((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return false;
    return (
      part.slice(0, separator).trim() === ACCESS_COOKIE &&
      part.slice(separator + 1).trim().length > 0
    );
  });
}

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
