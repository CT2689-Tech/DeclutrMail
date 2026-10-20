import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { schema } from '@declutrmail/db';
import { workerRuntimeConfig } from '@declutrmail/workers';
import { toSessionPoolUrl } from './session-pool-url.js';

/** Persistent postgres.js clients must not pipeline through transaction pooling. */
export function createWorkerDatabase(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const client = postgres(toSessionPoolUrl(env.DATABASE_URL), {
    prepare: false,
    max: workerRuntimeConfig(env).dbPoolMax,
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
