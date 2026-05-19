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
