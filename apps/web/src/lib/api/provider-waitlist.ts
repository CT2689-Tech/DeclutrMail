import type { Envelope, WaitlistV1JoinResult } from '@declutrmail/shared/contracts';

import { apiPost } from './client';

export interface ProviderWaitlistRequest {
  email: string;
  provider?: 'outlook' | 'm365' | 'yahoo_aol' | 'icloud' | 'other';
  wouldPay?: boolean;
  contactOptIn: boolean;
  source: 'landing' | 'sign_in';
}

export function joinProviderWaitlist(
  req: ProviderWaitlistRequest,
): Promise<Envelope<WaitlistV1JoinResult, unknown>> {
  return apiPost<WaitlistV1JoinResult>('/api/v1/waitlist', {
    kind: 'provider',
    email: req.email,
    ...(req.provider ? { provider: req.provider } : {}),
    ...(req.wouldPay ? { wouldPay: true } : {}),
    contactOptIn: req.contactOptIn,
    source: req.source,
  });
}
