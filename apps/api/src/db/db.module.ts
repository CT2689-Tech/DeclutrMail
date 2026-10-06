import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';

import {
  createApiDatabase,
  readApiPoolDiagnostics,
  type ApiDatabaseConnection,
  type DrizzleDb,
} from './api-database.js';
export type { DrizzleDb } from './api-database.js';

/** NestJS DI token for the Drizzle database instance. */
export const DRIZZLE = 'DRIZZLE';
/** Optional operational reader, also available to route-scoped error filters. */
export const API_POOL_DIAGNOSTICS = Symbol('API_POOL_DIAGNOSTICS');

/** Internal pool ownership; features receive only the ORM through DRIZZLE. */
const API_DATABASE_CONNECTION = Symbol('API_DATABASE_CONNECTION');

/**
 * DbModule — a thin provider exposing one Drizzle instance over the
 * selected API driver (D201 keeps DB access behind the module boundary).
 *
 * Global so feature modules inject `DRIZZLE` without re-importing.
 * `DATABASE_URL` is read from the environment.
 */
@Global()
@Module({
  providers: [
    { provide: API_DATABASE_CONNECTION, useFactory: () => createApiDatabase() },
    {
      provide: DRIZZLE,
      inject: [API_DATABASE_CONNECTION],
      useFactory: (connection: ApiDatabaseConnection) => connection.db,
    },
    {
      provide: API_POOL_DIAGNOSTICS,
      inject: [DRIZZLE],
      useFactory: (db: DrizzleDb) => () => readApiPoolDiagnostics(db),
    },
  ],
  exports: [DRIZZLE, API_POOL_DIAGNOSTICS],
})
export class DbModule implements OnApplicationShutdown {
  constructor(
    @Inject(API_DATABASE_CONNECTION) private readonly connection: ApiDatabaseConnection,
  ) {}
  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
