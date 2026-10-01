import type { DataExportFormat } from '@declutrmail/shared/contracts';

import { ApiError, recoverFromUnauthorized } from '@/lib/api/client';

async function fetchExport(format: DataExportFormat, isRetry: boolean): Promise<Response> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const res = await fetch(`${apiBase}/api/account/export?format=${format}`, {
    credentials: 'include',
    headers: { Accept: format === 'json' ? 'application/json' : 'text/csv' },
  });
  // Raw `fetch` skips `apiRequest`, so the 401 handling has to be
  // repeated here or an expired session surfaces as the generic export
  // failure — whose copy blames the rate limit and tells the user to
  // wait, which never recovers. Refresh once, replay once; a terminal
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

  // Filename from Content-Disposition when present; date-stamped fallback.
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const ext = format === 'json' ? 'json' : 'csv';
  const filename =
    match?.[1] ?? `declutrmail-export-${new Date().toISOString().slice(0, 10)}.${ext}`;

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
