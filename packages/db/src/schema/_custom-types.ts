import { customType } from 'drizzle-orm/pg-core';

/**
 * citext — Postgres case-insensitive text type (requires the `citext`
 * extension, enabled in migration 0000). Used for identity columns such
 * as `users.email` and `mailbox_accounts.provider_account_id` so casing
 * variants are the same identity at the DB uniqueness boundary.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * bytea — Postgres raw binary type. Used for the envelope-encrypted
 * OAuth-token columns on `mailbox_accounts` (D14): the encrypted refresh
 * token and the KMS-wrapped DEK are stored as `Buffer`s, no base64
 * round-tripping in app code.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
