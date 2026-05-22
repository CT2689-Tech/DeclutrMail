import type { Config } from 'drizzle-kit';

/**
 * Drizzle Kit config (D11 + D152).
 *
 * Schema lives in src/schema/*.ts — Drizzle scans the directory and
 * resolves table definitions.
 *
 * Migrations land in migrations/<timestamp>_<name>.sql. Each migration
 * gets a companion rollback file at migrations/<timestamp>_<name>.rollback.sql
 * per D152.
 *
 * Atlas (run in CI via .github/workflows/migration-lint.yml) lints the
 * generated SQL for dangerous operations before merge.
 *
 * No DATABASE_URL is required at generation time — drizzle-kit reads
 * the schema files directly and emits forward-only SQL.
 *
 * `dbCredentials.url` is read from `process.env.DATABASE_URL` when set
 * — required for `drizzle-kit studio` (the dev DB browser). `generate`
 * ignores the field, so a blank value does not break SQL emission.
 */
export default {
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './migrations',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config;
