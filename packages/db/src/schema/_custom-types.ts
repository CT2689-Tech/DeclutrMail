import { customType } from 'drizzle-orm/pg-core';

/**
 * citext — Postgres case-insensitive text type (requires the `citext`
 * extension, enabled in migration 0000). Used for `users.email` so that
 * `Foo@bar.com` and `foo@bar.com` are the same identity at the DB level
 * — no app-side normalization required, no risk of a missed lowercase
 * breaking the uniqueness invariant.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * bytea — Postgres raw binary type. Used for the envelope-encrypted
 * OAuth-token ciphertext and the KMS-wrapped DEK on `mailbox_accounts`
 * (D14). The data side is a Node `Buffer` so callers work with binary
 * directly — no base64 round-tripping in app code.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
