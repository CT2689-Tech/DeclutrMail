import { llmsResponse, renderLlmsTxt } from '@/features/marketing/llms/llms-document';

export async function GET(): Promise<Response> {
  return llmsResponse(await renderLlmsTxt());
}
