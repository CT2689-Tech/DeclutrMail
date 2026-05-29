/**
 * Gmail mutation port (D201 — external integrations sit behind an
 * interface). The label-modify sibling of `GmailMetadataClient`.
 *
 * `packages/workers` defines this port and depends on NOTHING
 * Gmail-specific; `apps/api` (`GmailClientService`) implements it and the
 * worker is injected the implementation. Dependency direction:
 * `apps/api → packages/workers`, never the reverse.
 *
 * PRIVACY — D7 / D228. This port mutates LABELS only. Every value that
 * crosses it is a Gmail label id or a Gmail message id — never a body,
 * attachment, raw MIME, or any header. A body cannot be represented by
 * these types, so it cannot leak through this port. The underlying
 * `messages.modify` / `messages.batchModify` calls are body-free by
 * construction (no `format` param, no response body read).
 */

/** A label-set delta — add and/or remove Gmail label ids on a message. */
export interface LabelChange {
  /** Gmail label ids to add (e.g. `TRASH`, a user label id). */
  addLabelIds?: string[];
  /** Gmail label ids to remove (e.g. `INBOX`, `UNREAD`). */
  removeLabelIds?: string[];
}

/** Mutate labels on a mailbox's messages — one at a time, or in bulk. */
export interface GmailMutationClient {
  /** Apply a label change to a single message (`messages.modify`). */
  modifyLabels(messageId: string, change: LabelChange): Promise<void>;
  /**
   * Apply the same label change to many messages
   * (`messages.batchModify`). Gmail caps a batch at 1000 ids per call;
   * the implementation chunks larger inputs into sequential calls.
   */
  batchModify(messageIds: string[], change: LabelChange): Promise<void>;
}

/**
 * Resolves a per-mailbox label-mutation client (the write sibling of
 * `GmailAccess`). The implementation (`apps/api`) loads the mailbox row,
 * decrypts the OAuth refresh token (D14 `TokenCryptoService`), and
 * returns a token-bound client — the SAME composition-root factory the
 * read path uses, since `GmailClientService` implements both ports.
 * Dependency direction: `apps/api → packages/workers`, never reverse.
 */
export interface GmailMutationAccess {
  getClient(mailboxAccountId: string): Promise<GmailMutationClient>;
}
