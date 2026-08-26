// @declutrmail/db — deterministic `senders.id` derivation.
//
// `senders.id` is the handle the API hands the frontend: it is in
// `/senders/:id` URLs, TanStack query keys, selection sets and the
// open confirm modal's preview request. The frontend treats it as
// stable for as long as the sender exists, because there is no reason
// a user would expect otherwise.
//
// It was not stable. `InitialSyncWorker.buildSenderIndex` rebuilds the
// index with `DELETE … WHERE mailbox_account_id = $1` followed by a
// plain `INSERT`, so a `defaultRandom()` primary key handed every
// sender a brand-new UUID on every rebuild. Prod, 2026-08-25: an
// initial sync committed at 08:05:17 and every id the already-open
// Senders page was holding died with it —
// `GET /api/actions/preview?senderId=018db6ee…` returned 200 at
// 08:03:52 and 404 at 08:06:21 for the same sender. The modal's "Retry
// preview" button refetched the same dead id, so it could never
// succeed; nothing on that page could recover without a reload.
//
// Deriving the id from `(mailbox_account_id, sender_key)` — the pair
// that already uniquely identifies a sender row
// (`senders_account_sender_key_uniq`) — makes the rebuild's
// delete+reinsert regenerate the SAME id. Identity survives the churn
// without the rebuild having to become an upsert, so the atomicity
// argument in `buildSenderIndex` (nuke + reinsert closes derived-row
// drift) is untouched.
//
// Nothing references `senders.id` by foreign key — every durable
// consumer joins on `sender_key` — so this changes no storage shape
// and needs no migration. Rows written before this landed keep their
// random ids until their mailbox's next rebuild, which flips them once
// and then never again.

import { createHash } from 'node:crypto';

/**
 * Namespace prefix, versioned so a future derivation change is a new
 * literal rather than a silent reshuffle of every existing id.
 */
const SENDER_ID_NAMESPACE = 'declutrmail.sender.v1';

/**
 * The stable `senders.id` for a `(mailboxAccountId, senderKey)` pair.
 *
 * Formatted as an RFC 9562 version-8 UUID: version 8 is the registered
 * shape for vendor-defined deterministic UUIDs, which is exactly what
 * this is (SHA-256 truncated to 128 bits, not the SHA-1 of a v5). The
 * column stays `uuid`, so every existing parser, `isUuid` guard and
 * branded `asSenderId` boundary keeps working unchanged.
 *
 * Per-mailbox by construction: the same sender emailing two connected
 * accounts gets two different ids, which is the invariant
 * `SenderKey`'s doc comment in `@declutrmail/shared` already states.
 */
export function deriveSenderId(mailboxAccountId: string, senderKey: string): string {
  const bytes = createHash('sha256')
    .update(`${SENDER_ID_NAMESPACE}|${mailboxAccountId}|${senderKey}`)
    .digest()
    .subarray(0, 16);
  // Version 8 (vendor-specific) in the high nibble of byte 6, RFC 4122
  // variant in the top two bits of byte 8. Everything else is digest.
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
