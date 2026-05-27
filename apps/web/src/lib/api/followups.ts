/**
 * Followups API — typed fetcher for the Followups Pro endpoints (D84-D91).
 *
 * Wire shape mirrors the BE contract frozen in
 * `apps/api/src/followups/followup.types.ts` and the controller in
 * `apps/api/src/followups/followup.controller.ts`. Any drift between
 * the BE return types and these declarations is a contract violation
 * the D202 envelope was designed to surface at compile time.
 *
 * Privacy (D7, D228). The BE explicitly never returns body, HTML,
 * attachments, or non-allowlisted headers. The shapes here document
 * what we expect — sender, subject, recipient metadata, and dates only.
 * No `snippet` either (followups are thread-scoped; the existing
 * snippet allowlist is for inbound mail surfaces).
 *
 * No client-side state lives here — the fetcher is a pure function
 * the TanStack Query hook in `features/followups/api/` calls from
 * `queryFn`.
 */

import type { Envelope } from '@declutrmail/shared/contracts';

import { apiGet } from './client';

/** D85 — priority bucket computed at request time from `sent_at`. */
export type FollowupPriorityWire = 'high' | 'medium' | 'low' | 'fresh';

/** Mirrors BE `FollowupStatus` (`followup_status` enum). */
export type FollowupStatusWire = 'awaiting' | 'replied' | 'dismissed';

/** One followup row on `GET /api/followups`. */
export interface FollowupRow {
  id: string;
  providerThreadId: string;
  recipientEmail: string;
  recipientDisplayName: string;
  subject: string;
  /** ISO-8601 — when the user's outbound message went out. */
  sentAt: string;
  /** D85 — computed at request time, never stored. */
  priority: FollowupPriorityWire;
  status: FollowupStatusWire;
  /** ISO-8601 — when the user dismissed (D88). NULL for active rows. */
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** GET /api/followups — list awaiting followups for the current mailbox. */
export function fetchFollowups(signal?: AbortSignal): Promise<Envelope<FollowupRow[], unknown>> {
  return apiGet<FollowupRow[]>('/api/followups', { signal });
}
