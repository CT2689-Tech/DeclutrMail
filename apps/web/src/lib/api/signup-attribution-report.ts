import { SignupAttributionReportSchema } from '@declutrmail/shared/contracts';
import { apiGet } from './client';

export async function readSignupAttributionReport(signal?: AbortSignal) {
  const response = await apiGet('/api/admin/signup-attribution', { signal });
  return SignupAttributionReportSchema.parse(response.data);
}
