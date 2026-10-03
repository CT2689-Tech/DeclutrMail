import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { ApiError, recoverFromUnauthorized } from '@/lib/api/client';

async function fetchExport(format: DataExportFormat, isRetry: boolean): Promise<Response> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const res = await fetch(`${apiBase}/api/account/export?format=${format}`, {
    credentials: 'include',
    headers: { Accept: format === 'json' ? 'application/json' : 'text/csv' },
  });
  // Raw `fetch` skips `apiRequest`, so the 401 handling has to be
  // repeated here so an expired session can recover instead of leaving
  // the user with a failed export. Refresh once, replay once; a terminal
  // 401 hard-redirects to re-auth from inside the helper.
  if (res.status === 401 && (await recoverFromUnauthorized(isRetry))) {
    return fetchExport(format, true);
  }
  return res;
}

export async function downloadExport(format: DataExportFormat): Promise<void> {
  const res = await fetchExport(format, false);
  if (!res.ok) {
    throw new ApiError(res.status, null, `GET /api/account/export failed: ${res.status}`);
  }
  const blob = await res.blob();

  // Content-Disposition may be unavailable on a cross-origin response.
  // Keep the selected dataset in its fallback name, matching the API filenames.
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const ext = format === 'json' ? 'json' : 'csv';
  const dataset =
    format === 'senders-csv' ? 'senders' : format === 'decisions-csv' ? 'decisions' : 'export';
  const filename =
    match?.[1] ?? `declutrmail-${dataset}-${new Date().toISOString().slice(0, 10)}.${ext}`;

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
