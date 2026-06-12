/**
 * `useDataExport` — client side of GET /api/account/export (D116 +
 * D228 + DPDP).
 *
 * The endpoint streams a FILE (json/csv with Content-Disposition), not
 * a D202 envelope, so this hook uses raw `fetch` (cookies ride along
 * via `credentials: 'include'`) and hands the blob to a synthetic
 * `<a download>` click. Mutation-shaped so callers get isPending /
 * isError per attempt.
 *
 * Observability: fires `data_export_requested` with the terminal
 * outcome — success after the blob saves, failed on any error
 * (including 429 from the export rate limit).
 */

import { useMutation } from '@tanstack/react-query';
import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { ApiError } from '@/lib/api/client';
import { track } from '@/lib/posthog';

async function downloadExport(format: DataExportFormat): Promise<void> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const res = await fetch(`${apiBase}/api/account/export?format=${format}`, {
    credentials: 'include',
    headers: { Accept: format === 'csv' ? 'text/csv' : 'application/json' },
  });
  if (!res.ok) {
    throw new ApiError(res.status, null, `GET /api/account/export failed: ${res.status}`);
  }
  const blob = await res.blob();

  // Filename from Content-Disposition when present; date-stamped fallback.
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename =
    match?.[1] ?? `declutrmail-export-${new Date().toISOString().slice(0, 10)}.${format}`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useDataExport() {
  return useMutation({
    mutationFn: downloadExport,
    onSuccess: (_data, format) => {
      void track('data_export_requested', { format, outcome: 'success' });
    },
    onError: (_error, format) => {
      void track('data_export_requested', { format, outcome: 'failed' });
    },
  });
}
