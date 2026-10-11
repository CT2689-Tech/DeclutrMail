import { llmsResponse, renderLlmsTxt } from '@/features/marketing/llms/llms-document';

export function GET(): Response {
  return llmsResponse(renderLlmsTxt());
}
