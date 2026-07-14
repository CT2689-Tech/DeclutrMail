import { z } from 'zod';

import { GMAIL_DATA_INVENTORY, type GmailDataExportFormat } from './gmail-data-inventory';

/**
 * GET /api/account/export query contract (D116 + D228 + DPDP).
 *
 * The response is a FILE STREAM (`application/json` or `text/csv` with
 * `Content-Disposition: attachment`), not a D202 envelope — the one
 * documented envelope exemption alongside OAuth redirects. Errors
 * (401/429) still use the error envelope.
 *
 * Formats:
 *   - `json`          — a portable subset: mailbox connection summary,
 *     senders (with selected standing policy fields), selected message
 *     metadata, and the activity log.
 *   - `csv`           — the message metadata index (one row per
 *     message), the canonical "what we store about your mail" artifact.
 *   - `senders-csv`   — the sender index with standing policies (one
 *     row per sender). Sender metadata only — no subject/snippet
 *     columns exist in this dataset.
 *   - `decisions-csv` — the user's decision history (one row per
 *     activity-log entry). Action metadata only — no subject/snippet
 *     columns exist in this dataset.
 *
 * PRIVACY (D7/D228): every dataset is built from explicit-column
 * SELECTs over the storage allowlist — sender (name + email), subject,
 * snippet, dates, Gmail labels, read/unread state, plus the user's own
 * decisions. Bodies do not exist in the DB and the queries can never
 * widen to `SELECT *`. OAuth tokens are excluded by construction.
 */
export const DataExportFormatSchema = z.enum(['json', 'csv', 'senders-csv', 'decisions-csv']);

export type DataExportFormat = z.infer<typeof DataExportFormatSchema>;

export interface DataExportFormatDefinition {
  label: string;
  buttonLabel: string;
  pendingLabel: string;
  description: string;
  includedInventoryIds: readonly string[];
  completeAccountExport: false;
}

function includedInventoryIds(format: GmailDataExportFormat): readonly string[] {
  return Object.freeze(
    GMAIL_DATA_INVENTORY.filter((item) =>
      item.exportedIn.some((exportFormat) => exportFormat === format),
    ).map((item) => item.id),
  );
}

/**
 * Honest, generated format manifest. `completeAccountExport` is deliberately
 * false until every stored account and mailbox dataset is exported.
 */
export const DATA_EXPORT_FORMAT_MANIFEST = {
  json: {
    label: 'Account data subset (JSON)',
    buttonLabel: 'Download JSON subset',
    pendingLabel: 'Preparing JSON…',
    description:
      'Mailbox addresses and status, sender profiles with selected policy fields, selected message metadata, and Activity rows.',
    includedInventoryIds: includedInventoryIds('json'),
    completeAccountExport: false,
  },
  csv: {
    label: 'Selected message metadata (CSV)',
    buttonLabel: 'Messages CSV',
    pendingLabel: 'Preparing messages CSV…',
    description:
      'Sender name and address, subject, Gmail Preview, received date, labels, and read state for each exported message.',
    includedInventoryIds: includedInventoryIds('csv'),
    completeAccountExport: false,
  },
  'senders-csv': {
    label: 'Sender profiles and selected policies (CSV)',
    buttonLabel: 'Senders CSV',
    pendingLabel: 'Preparing senders CSV…',
    description:
      'Sender identity and observed totals plus selected Keep, Archive, Unsubscribe, Later, VIP, and Protected fields.',
    includedInventoryIds: includedInventoryIds('senders-csv'),
    completeAccountExport: false,
  },
  'decisions-csv': {
    label: 'Activity decisions (CSV)',
    buttonLabel: 'Decisions CSV',
    pendingLabel: 'Preparing decisions CSV…',
    description: 'Activity time, source, action, affected count, and sender address.',
    includedInventoryIds: includedInventoryIds('decisions-csv'),
    completeAccountExport: false,
  },
} as const satisfies Record<DataExportFormat, DataExportFormatDefinition>;

export const DATA_EXPORT_LIMITATION =
  'These downloads are portable views of the listed datasets, not a complete copy of every DeclutrMail record. OAuth credentials are never exported.' as const;
