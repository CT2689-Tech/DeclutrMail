/**
 * GmailCategory — cross-package mirror of the `gmail_category` Postgres
 * enum.
 *
 * The DB schema in `packages/db/src/schema/senders.ts` is the canonical
 * source. This mirror exists because `@declutrmail/shared` is zero-
 * server-dep — the contract test in `apps/api/src/senders/senders.types.ts`
 * fails-compile if the API/DB type and this mirror ever drift.
 */
export type GmailCategory = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
