import { z } from 'zod';

/**
 * GET /api/account/export query contract (D116 + D228 + DPDP).
 *
 * The response is a FILE STREAM (`application/json` or `text/csv` with
 * `Content-Disposition: attachment`), not a D202 envelope — the one
 * documented envelope exemption alongside OAuth redirects. Errors
 * (401/429) still use the error envelope.
 *
 * Formats:
 *   - `json`          — the full export: profile, mailboxes, senders
 *     (with standing policies + last verdict), message metadata index,
 *     and the activity log.
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
