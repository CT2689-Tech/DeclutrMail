// `/confirm/<previewId>` — where a person confirms a cleanup an assistant
// prepared through the MCP connector (ADR-0048 rule 1,
// docs/spec/mcp-connector.md §3).
//
// The assistant holds the preview id and this link; it cannot press the
// button. The confirmation is a session-cookie + CSRF request from this
// page, credentials an MCP client does not have.
//
// The page reuses the existing DeclutrMail session: a signed-out
// visitor's first read answers 401 and the API client sends them through
// Google sign-in and back to this URL. While the connector is switched
// off the API answers 404 for every preview, and the page says the
// request is not available.
//
// Outside the app shell on purpose — like `/connect/authorize`, this is
// one decision, not a place to navigate from.

import type { Metadata } from 'next';

import { ConfirmScreen } from '@/features/connected-apps/confirm-screen';

export const metadata: Metadata = {
  title: 'Confirm a request — DeclutrMail',
  robots: { index: false, follow: false },
};

export default async function ConfirmPreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = await params;
  return <ConfirmScreen previewId={previewId} />;
}
