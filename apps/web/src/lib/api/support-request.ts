import type {
  Envelope,
  SupportRequestPayload,
  SupportRequestResult,
} from '@declutrmail/shared/contracts';

import { apiPost } from './client';

export function postSupportRequest(
  payload: SupportRequestPayload,
): Promise<Envelope<SupportRequestResult, unknown>> {
  return apiPost<SupportRequestResult>('/api/support-request', payload);
}
