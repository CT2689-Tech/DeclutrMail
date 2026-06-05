/**
 * Gmail ports (D201 — external integrations sit behind an interface).
 *
 * `packages/workers` defines these port interfaces and depends on NOTHING
 * Gmail-specific. `apps/api` implements them (`GmailClientService`,
 * `GmailAccess` composition root) and injects the implementation into the
 * worker. Dependency direction: `apps/api → packages/workers`, never the
 * reverse.
 */

/**
 * One message's metadata — the D7 storage allowlist and nothing else.
 *
 * Sourced from `messages.get?format=metadata`. There is deliberately no
 * field for body, MIME, attachments, or `sizeEstimate`: a body cannot be
 * represented by this type, so it cannot leak through this port.
 *
 * D7 allowlist amendment (ADR-0004) added `to`, `cc`, `listUnsubscribe`,
 * and `listUnsubscribePost` — see the schema docs on `mail_messages`
 * for the per-field rationale.
 */
export interface GmailMessageMetadata {
  /** Gmail message id. */
  id: string;
  /** Gmail thread id. */
  threadId: string;
  /** Gmail label ids (INBOX, UNREAD, CATEGORY_*, …). */
  labelIds: string[];
  /** Gmail's own short preview — allowlisted by D7. */
  snippet: string;
  /** Gmail `internalDate` — ms since epoch, as a string. */
  internalDate: string;
  /** Raw `From` header value, or `null` if absent. */
  from: string | null;
  /** Raw `Subject` header value, or `null` if absent. */
  subject: string | null;
  /** Raw `To` header value, or `null` if absent. Used on outbound (D9 area). */
  to: string | null;
  /** Raw `Cc` header value, or `null` if absent. */
  cc: string | null;
  /** Raw `List-Unsubscribe` header value, or `null` if absent (D9, RFC 8058). */
  listUnsubscribe: string | null;
  /** Raw `List-Unsubscribe-Post` header value, or `null` if absent (RFC 8058). */
  listUnsubscribePost: string | null;
}

/** One page of `messages.list`. */
export interface GmailMessageListPage {
  /** Gmail message ids on this page. */
  ids: string[];
  /** Cursor for the next page; omitted on the last page. */
  nextPageToken?: string;
}

/**
 * A single `users.history.list` record — Gmail's incremental change log.
 *
 * Each record is anchored to a `historyId` (Gmail's monotonic mailbox-
 * level cursor; D229). The four event kinds correspond to Gmail's REST
 * shapes (`messagesAdded`, `messagesDeleted`, `labelsAdded`,
 * `labelsRemoved`); the union is normalised here so the worker can
 * pattern-match without depending on Gmail's exact wire shape.
 *
 * PRIVACY (D7 / D228). Only the message id, thread id, and label ids
 * are surfaced — no header, no body. The worker fetches full metadata
 * via the existing `getMessageMetadata` port only for `added` records,
 * and `messages.get` is itself body-free by the `METADATA_FORMAT`
 * constant in the Gmail adapter.
 */
export type GmailHistoryRecord =
  | {
      kind: 'added';
      messageId: string;
      threadId: string;
      labelIds: string[];
    }
  | {
      kind: 'deleted';
      messageId: string;
      threadId: string;
    }
  | {
      kind: 'labels_added';
      messageId: string;
      labelIds: string[];
    }
  | {
      kind: 'labels_removed';
      messageId: string;
      labelIds: string[];
    };

/** One page of `users.history.list`. */
export interface GmailHistoryPage {
  /** Normalised records on this page in source order. */
  records: GmailHistoryRecord[];
  /** Cursor for the next page; omitted on the last page. */
  nextPageToken?: string;
  /**
   * The historyId Gmail reports as the most-recent on the mailbox at
   * fetch time. The worker uses this to advance
   * `provider_sync_state.last_history_id` only after every page is
   * processed successfully — partial advance would leave the next
   * webhook unable to find the gap.
   */
  historyId: string;
}

/**
 * A Gmail client already bound to one mailbox's credentials. Exposes
 * only the two metadata-only calls the backfill needs.
 */
export interface GmailMetadataClient {
  /** Page through every message id in the mailbox. */
  listMessageIds(pageToken?: string): Promise<GmailMessageListPage>;
  /**
   * Fetch one message's metadata — `format=metadata` only (D7). Resolves
   * `null` when the message no longer exists (deleted between list+get).
   */
  getMessageMetadata(messageId: string): Promise<GmailMessageMetadata | null>;
  /**
   * Snapshot the mailbox's user-level `historyId` at sync start so the
   * incremental sync (PR-D) can `history.list?startHistoryId=...` from
   * that point. Capturing BEFORE the fetch starts means any change
   * during the fetch is replayed by the first incremental run.
   */
  getProfile(): Promise<{ historyId: string }>;
  /**
   * Page through `users.history.list` starting at the given historyId.
   * Returns normalised `GmailHistoryRecord`s plus the mailbox's
   * current historyId for cursor advancement. `null` when Gmail
   * returns a 404 (`startHistoryId` too old — the worker must
   * fall back to a full re-sync) so the caller decides the recovery
   * path rather than throwing through the port.
   */
  listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage | null>;
}

/**
 * Resolves a per-mailbox authenticated client. The implementation
 * (`apps/api`) loads the mailbox row, decrypts the OAuth refresh token
 * (D14 `TokenCryptoService`), and returns a token-bound client.
 */
export interface GmailAccess {
  getClient(mailboxAccountId: string): Promise<GmailMetadataClient>;
}
