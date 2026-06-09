import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { Global, Module } from '@nestjs/common';
import { schema } from '@declutrmail/db';
import postgres from 'postgres';

/** NestJS DI token for the Drizzle database instance. */
export const DRIZZLE = 'DRIZZLE';

/** The Drizzle client type, bound to the full `@declutrmail/db` schema. */
export type DrizzleDb = PostgresJsDatabase<typeof schema>;

/**
 * DbModule — a thin provider exposing one Drizzle instance over the
 * `postgres` driver (D201 keeps DB access behind the module boundary).
 *
 * Global so feature modules inject `DRIZZLE` without re-importing.
 * `DATABASE_URL` is read from the environment.
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useFactory: (): DrizzleDb => {
        const url = process.env.DATABASE_URL;
        if (!url) {
          throw new Error('DATABASE_URL is not set — see .env.example.');
        }
        // `prepare: false` is REQUIRED for Supabase's transaction-mode
        // pooler (`*.pooler.supabase.com:6543`): the pooler routes
        // per-statement to whatever backend is free, so cached prepared-
        // statement names from a prior backend throw `prepared statement
        // "X" does not exist` mid-tx → silent ROLLBACK of multi-statement
        // queries. Local dev uses direct 5432 where prepared statements
        // work fine; setting prepare:false is a no-op there. See
        // ADR-0022 + apps/api/src/worker.ts for the same rationale on
        // the worker side.
        const client = postgres(url, { prepare: false });
        return drizzle(client, { schema });
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DbModule {}
