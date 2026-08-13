import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../schema';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations');

/**
 * A migrated, empty PGlite database for tests.
 *
 * Booting PGlite and replaying every migration costs ~840ms; restoring a
 * dump of that same end state costs ~145ms. Before this helper, ~56 spec
 * files each carried their own copy of the replay loop and called it from
 * `beforeEach`, so the API suite paid the full price 700+ times per run —
 * roughly a third of its total test time, spent recomputing a byte-identical
 * schema.
 *
 * The snapshot is memoised per PROCESS. Vitest resets the module registry
 * per test FILE, so in practice this amortises across every `it()` in a file
 * and rebuilds once per file (~60 builds per run instead of ~700). A
 * disk-backed cache would collapse that to one, but it would need
 * content-hash invalidation, and a stale snapshot that silently outlives a
 * new migration is a far worse failure than 60 rebuilds — every spec in the
 * repo would then be asserting against a schema that no longer exists.
 *
 * Restores are fully independent: writes through one handle are invisible to
 * every other, and the `citext` extension survives the round trip.
 */
let migratedSnapshot: Promise<Blob> | undefined;

async function buildMigratedSnapshot(): Promise<Blob> {
  const pg = new PGlite({ extensions: { citext } });
  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      for (const stmt of sql.split('--> statement-breakpoint')) {
        const trimmed = stmt.trim();
        if (trimmed) await pg.query(trimmed);
      }
    }
    // `none` on purpose: the snapshot never leaves the process, so paying
    // gzip on every restore would give back the time this exists to save.
    return await pg.dumpDataDir('none');
  } finally {
    await pg.close();
  }
}

/** A migrated, empty PGlite instance. Prefer {@link freshTestDb}. */
export async function freshTestPglite(): Promise<PGlite> {
  migratedSnapshot ??= buildMigratedSnapshot();
  return new PGlite({ loadDataDir: await migratedSnapshot, extensions: { citext } });
}

/** A Drizzle client over a migrated, empty PGlite instance. */
export async function freshTestDb() {
  return drizzle(await freshTestPglite(), { schema });
}
