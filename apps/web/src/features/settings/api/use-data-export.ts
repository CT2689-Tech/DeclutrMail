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

import { track } from '@/lib/posthog';

export function useDataExport() {
  return useMutation({
    // The file/blob machinery is only needed after an explicit export request.
    mutationFn: async (format: DataExportFormat) => {
      const { downloadExport } = await import('./data-export-download');
      return downloadExport(format);
    },
    onSuccess: (_data, format) => {
      void track('data_export_requested', { format, outcome: 'success' });
    },
    onError: (_error, format) => {
      void track('data_export_requested', { format, outcome: 'failed' });
    },
  });
}
