import type {
  Envelope,
  ProductFeedbackRequest,
  ProductFeedbackResult,
} from '@declutrmail/shared/contracts';

import { apiPost } from './client';

export function postProductFeedback(
  request: ProductFeedbackRequest,
): Promise<Envelope<ProductFeedbackResult, unknown>> {
  return apiPost<ProductFeedbackResult>('/api/product-feedback', request);
}
