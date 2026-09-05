/** Local-only failure fixture. Never changes OAuth tokens or sync cursors. */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const requireApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const postgres = requireApi('postgres');
const [mode, email] = process.argv.slice(2);
if (
  !['reconnect', 'rate-limit', 'restore'].includes(mode) ||
  !/^chintan[^\s@]*@gmail\.com$/.test(email ?? '')
)
  throw new Error(
    'Usage: node scripts/dev-sync-recovery.mjs reconnect|rate-limit|restore <your chintan…@gmail.com dev account>',
  );
// Fixed loopback database: deliberately do not accept DATABASE_URL or remote hosts.
const sql = postgres('postgresql://postgres:postgres@127.0.0.1:5432/declutrmail', { max: 1 });
const directory = resolve('.local-logs');
await mkdir(directory, { recursive: true, mode: 0o700 });
try {
  const [account] =
    await sql`SELECT id FROM mailbox_accounts WHERE provider_account_id=${email} AND status='active'`;
  if (!account) throw new Error('Connect this account in local dev first');
  const file = resolve(directory, `sync-recovery-${account.id}.json`);
  const fields = [
    'readiness_status',
    'current_stage',
    'progress_pct',
    'error_code',
    'last_incremental_error_code',
    'last_incremental_error_at',
    'updated_at',
  ];
  if (mode === 'restore') {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const result =
      await sql`UPDATE provider_sync_state SET ${sql(saved.before, ...fields)} WHERE mailbox_account_id=${account.id} AND updated_at::text=${saved.injectedAt}::text RETURNING mailbox_account_id`;
    if (!result.length)
      throw new Error(
        'State changed after injection; refusing to overwrite a reconnect or sync. Leave the new state intact.',
      );
    await unlink(file);
    console.log('Restored local pre-test status. OAuth tokens and cursors were untouched.');
  } else {
    const [state] =
      await sql`SELECT ${sql(fields)}, updated_at::text AS updated_at, last_incremental_error_at::text AS last_incremental_error_at FROM provider_sync_state WHERE mailbox_account_id=${account.id}`;
    if (!state) throw new Error('No local sync state exists');
    const injectedAt = new Date().toISOString();
    await writeFile(file, JSON.stringify({ before: state, injectedAt }), {
      flag: 'wx',
      mode: 0o600,
    });
    const error = mode === 'reconnect' ? 'InvalidGrantError' : 'RateLimitError';
    const result =
      await sql`UPDATE provider_sync_state SET readiness_status='failed', current_stage='failed', progress_pct=5, error_code=${error}, last_incremental_error_code=${error}, last_incremental_error_at=${injectedAt}, updated_at=${injectedAt} WHERE mailbox_account_id=${account.id} AND updated_at::text=${state.updated_at}::text RETURNING updated_at::text AS stamp`;
    if (!result.length) {
      await unlink(file);
      throw new Error('Concurrent sync changed state; fixture was not applied');
    }
    // The database trigger owns updated_at; preserve its microsecond precision.
    await writeFile(file, JSON.stringify({ before: state, injectedAt: result[0].stamp }), {
      mode: 0o600,
    });
    console.log(`Local ${mode} status applied. No email sent; tokens/cursors unchanged.`);
    console.log(`http://localhost:3109/onboarding?mailbox=${account.id}`);
    console.log(
      `Restore without reconnecting: node scripts/dev-sync-recovery.mjs restore ${email}`,
    );
  }
} finally {
  await sql.end();
}
