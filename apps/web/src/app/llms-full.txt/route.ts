import { llmsResponse, renderLlmsFullTxt } from '@/features/marketing/llms/llms-document';

export function GET(): Response {
  return llmsResponse(renderLlmsFullTxt());
}
