/**
 * Waitlist API — typed fetcher for `POST /api/waitlist` (D19).
 *
 * Public (pre-auth) endpoint: the BE applies no session guard, so this
 * is callable from `(marketing)` pages where no AuthProvider exists.
 * The server returns the SAME 202 body for new and duplicate emails —
 * the UI must not (and cannot) branch on "already signed up" (no
 * email-exists oracle).
 *
 * Privacy (D7): the payload is the visitor's explicitly submitted email
 * plus app-chosen attribution. Nothing else leaves the browser.
 */

import type {
  Envelope,
  WaitlistJoinRequest,
  WaitlistJoinResult,
} from '@declutrmail/shared/contracts';
import { apiPost } from './client';

export async function joinWaitlist(
  req: WaitlistJoinRequest,
): Promise<Envelope<WaitlistJoinResult, unknown>> {
  return apiPost<WaitlistJoinResult>('/api/waitlist', req);
}
