import { useMutation } from '@tanstack/react-query';

import type { ActivityFilters } from '@/lib/api/activity';
import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

export interface ActivitySupportBundleRequest {
  filters: ActivityFilters;
  mailboxId: string | null;
  includeFullSenderAddresses: boolean;
  includeTechnicalDetails: boolean;
}

export async function downloadActivitySupportBundle(
  request: ActivitySupportBundleRequest,
): Promise<void> {
  const query = new URLSearchParams();
  query.set('window', request.filters.window ?? '30d');
  if (request.filters.source && request.filters.source !== 'all') {
    query.set('source', request.filters.source);
  }
  if (request.filters.verbs && request.filters.verbs.length > 0) {
    query.set('verb', request.filters.verbs.join(','));
  }
  if (request.filters.senderQuery) query.set('sender_q', request.filters.senderQuery);
  if (request.filters.dateFrom) query.set('date_from', request.filters.dateFrom);
  if (request.filters.dateTo) query.set('date_to', request.filters.dateTo);
  if (request.filters.outcomes && request.filters.outcomes.length > 0) {
    query.set('outcome', request.filters.outcomes.join(','));
  }
  query.set('sender_addresses', request.includeFullSenderAddresses ? 'full' : 'masked');
  query.set('include_technical', request.includeTechnicalDetails ? 'true' : 'false');

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const headers: Record<string, string> = { Accept: 'application/zip' };
  if (request.mailboxId) headers['X-Active-Mailbox-Id'] = request.mailboxId;
  const response = await fetch(`${apiBase}/api/activity/export?${query.toString()}`, {
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body,
      `GET /api/activity/export failed: ${response.status}`,
    );
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename =
    /filename="([^"]+)"/.exec(disposition)?.[1] ??
    `declutrmail-activity-support-${new Date().toISOString().slice(0, 10)}.zip`;
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useActivitySupportBundle() {
  return useMutation({
    mutationFn: downloadActivitySupportBundle,
    onSuccess: (_data, request) => {
      void track('activity_support_bundle_exported', {
        outcome: 'success',
        full_sender_addresses: request.includeFullSenderAddresses,
        technical_details: request.includeTechnicalDetails,
      });
    },
    onError: (_error, request) => {
      void track('activity_support_bundle_exported', {
        outcome: 'failed',
        full_sender_addresses: request.includeFullSenderAddresses,
        technical_details: request.includeTechnicalDetails,
      });
    },
  });
}
