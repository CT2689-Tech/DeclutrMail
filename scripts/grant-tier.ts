#!/usr/bin/env tsx
/**
 * scripts/grant-tier.ts
 *
 * Comp an email onto Plus or Pro — the admin surface for
 * `entitlement_grants`.
 *
 *   pnpm grant-tier list
 *   pnpm grant-tier grant <email> <tier> --reason="advisor" [--expires=2026-12-31]
 *   pnpm grant-tier revoke <email>
 *
 * Add `--prod` to act on production (`SUPABASE_SESSION_DSN`); without
 * it every command runs against the local dev DB. The flag is required
 * rather than inferred because the two databases are one typo apart and
 * only one of them has customers in it.
 *
 * WHAT A GRANT IS. A FLOOR on `workspaces.tier`, never a replacement —
 * see apps/api/src/common/entitlements/entitlement-grants.ts for the
 * full reasoning. The short version: both tier-recompute paths derive
 * the tier from `subscriptions` and fall back to 'free', so a bare
 * `UPDATE workspaces SET tier` survives only until the comped person
 * opens a checkout. Resolving as a floor also composes correctly — a
 * comped Pro who buys Plus stays Pro, and an expiring comp drops to the
 * paid tier rather than to Free.
 *
 * Grants are keyed on EMAIL, so one can be written before that person
 * has ever signed up: signup reads this table when it bootstraps their
 * workspace. For an email that HAS signed up, this script applies the
 * new tier immediately rather than leaving it to the 6-hourly
 * reconciliation sweep.
 *
 * Privacy (D7, D228): reads and writes an email address and a tier.
 * Nothing message-derived.
 */

import { createInterface } from 'node:readline/promises';

import postgres from 'postgres';

import { TIER_RANK, type TierId } from '../packages/shared/src/entitlements/types.js';

/** Tiers a comp may grant. Free is not a comp, and Team/Enterprise are unbuilt. */
const GRANTABLE = ['plus', 'pro'] as const;
type GrantableTier = (typeof GRANTABLE)[number];

const LOCAL_DSN = 'postgresql://postgres:postgres@localhost:5432/declutrmail';

interface Args {
  command: 'list' | 'grant' | 'revoke';
  email: string | null;
  tier: GrantableTier | null;
  reason: string | null;
  grantedBy: string;
  expiresAt: Date | null;
  prod: boolean;
}

function usage(message: string): never {
  console.error(`✗ ${message}

Usage:
  pnpm grant-tier list [--prod]
  pnpm grant-tier grant <email> <${GRANTABLE.join('|')}> --reason="why" [--expires=YYYY-MM-DD] [--by=name] [--prod]
  pnpm grant-tier revoke <email> [--prod]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? 'true');
    else positional.push(arg);
  }

  const command = positional[0];
  if (command !== 'list' && command !== 'grant' && command !== 'revoke') {
    usage(`unknown command ${command ? `"${command}"` : '(none given)'}`);
  }

  const prod = flags.get('prod') === 'true';
  if (command === 'list') {
    return {
      command,
      email: null,
      tier: null,
      reason: null,
      grantedBy: '',
      expiresAt: null,
      prod,
    };
  }

  const email = positional[1];
  if (!email || !email.includes('@')) usage('an email address is required');

  if (command === 'revoke') {
    return { command, email, tier: null, reason: null, grantedBy: '', expiresAt: null, prod };
  }

  const tier = positional[2];
  if (!isGrantable(tier)) usage(`tier must be one of ${GRANTABLE.join(', ')}`);

  // Required, not defaulted. A comp with no stated reason is
  // indistinguishable six months on from a tier set by mistake.
  const reason = flags.get('reason');
  if (!reason || reason === 'true') usage('--reason="why this comp exists" is required');

  let expiresAt: Date | null = null;
  const rawExpiry = flags.get('expires');
  if (rawExpiry && rawExpiry !== 'true') {
    // End of the named day, UTC — "--expires=2026-12-31" should mean
    // "through the 31st", not "at midnight as the 31st begins".
    const parsed = new Date(`${rawExpiry}T23:59:59Z`);
    if (Number.isNaN(parsed.getTime())) usage(`--expires must be YYYY-MM-DD, got "${rawExpiry}"`);
    if (parsed.getTime() <= Date.now()) usage(`--expires is in the past (${rawExpiry})`);
    expiresAt = parsed;
  }

  return {
    command,
    email,
    tier,
    reason,
    grantedBy: flags.get('by') ?? process.env.USER ?? 'founder',
    expiresAt,
    prod,
  };
}

function isGrantable(value: string | undefined): value is GrantableTier {
  return value !== undefined && (GRANTABLE as readonly string[]).includes(value);
}

/**
 * `ORDER BY <this> DESC LIMIT 1` picks the highest tier in a set,
 * derived from the manifest rather than hand-written — the same
 * ordering the API's two recompute paths use. A hardcoded CASE here
 * would sort a newly-added tier below Free and silently stop granting.
 */
function tierRankCase(column: string): string {
  const branches = Object.entries(TIER_RANK)
    .map(([tier, rank]) => `WHEN '${tier}' THEN ${rank}`)
    .join(' ');
  return `CASE ${column} ${branches} ELSE 0 END`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let dsn = LOCAL_DSN;
  if (args.prod) {
    const prodDsn = process.env.SUPABASE_SESSION_DSN;
    if (!prodDsn) {
      console.error('✗ --prod needs SUPABASE_SESSION_DSN in the environment');
      process.exit(2);
    }
    dsn = prodDsn;
  }

  const target = args.prod ? 'PRODUCTION' : 'local dev';
  const sql = postgres(dsn, { max: 1, idle_timeout: 5, connect_timeout: 10 });

  try {
    if (args.command === 'list') {
      await listGrants(sql, target);
      return;
    }

    const email = args.email as string;

    // Production writes are confirmed by hand. This grants or removes a
    // paid entitlement on a real account; the local DB needs no such
    // ceremony.
    if (args.prod && !(await confirm(`${args.command} ${args.email} on PRODUCTION?`))) {
      console.log('Aborted — nothing written.');
      return;
    }

    if (args.command === 'revoke') {
      const revoked = await sql`
        UPDATE entitlement_grants
        SET revoked_at = now()
        WHERE email = ${email} AND revoked_at IS NULL
        RETURNING tier
      `;
      if (revoked.length === 0) {
        console.log(`No live grant for ${email} on ${target} — nothing to revoke.`);
        return;
      }
      console.log(`✓ Revoked the ${revoked[0].tier} comp for ${email} on ${target}.`);
    } else {
      await sql`
        INSERT INTO entitlement_grants (email, tier, reason, granted_by, expires_at)
        VALUES (${email}, ${args.tier as string}, ${args.reason as string}, ${args.grantedBy}, ${args.expiresAt})
        ON CONFLICT (email) DO UPDATE SET
          tier = EXCLUDED.tier,
          reason = EXCLUDED.reason,
          granted_by = EXCLUDED.granted_by,
          expires_at = EXCLUDED.expires_at,
          revoked_at = NULL
      `;
      const until = args.expiresAt ? ` through ${args.expiresAt.toISOString().slice(0, 10)}` : '';
      console.log(`✓ ${email} is comped to ${args.tier}${until} on ${target}.`);
    }

    await applyToWorkspace(sql, email, target);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Resolve the grantee's workspace tier NOW, instead of waiting up to
 * six hours for the reconciliation sweep to notice. Same max-rank rule
 * as both API recompute paths — subscriptions, live grants, and a
 * 'free' floor, highest wins.
 *
 * No-ops when the email has not signed up yet: there is no workspace to
 * write, and signup applies the grant itself when it bootstraps one.
 */
async function applyToWorkspace(sql: postgres.Sql, email: string, target: string): Promise<void> {
  const updated = await sql.unsafe(
    `
    UPDATE workspaces w
    SET tier = (
          SELECT c.t FROM (
            SELECT s.tier AS t FROM subscriptions s
            WHERE s.workspace_id = w.id
              AND s.status IN ('active', 'past_due')
              AND (s.entitlement_ends_at IS NULL OR s.entitlement_ends_at > now())
            UNION ALL
            SELECT g.tier FROM entitlement_grants g
            JOIN users u2 ON u2.email = g.email
            WHERE u2.workspace_id = w.id
              AND g.revoked_at IS NULL
              AND (g.expires_at IS NULL OR g.expires_at > now())
            UNION ALL
            SELECT 'free'::workspace_tier
          ) c
          ORDER BY ${tierRankCase('c.t')} DESC
          LIMIT 1),
        updated_at = now()
    FROM users u
    WHERE u.workspace_id = w.id AND u.email = $1
    RETURNING w.id, w.tier
  `,
    [email],
  );

  if (updated.length === 0) {
    console.log(`  ${email} has not signed up on ${target} yet — the grant applies when they do.`);
    return;
  }
  const row = updated[0] as { id: string; tier: TierId };
  console.log(`  Workspace ${row.id} is now on ${row.tier}.`);
  // D251: dropping below `autopilot-active` must also demote active
  // rules. That demotion lives in the API (the Autopilot facade) and
  // runs GLOBALLY in the 6-hourly sweep, so a revoke converges within
  // one sweep — this script deliberately does not reach into automation
  // tables (D204: billing never writes them).
  if (TIER_RANK[row.tier] < TIER_RANK.pro) {
    console.log('  Any active Autopilot rules demote on the next reconciliation sweep (≤6h).');
  }
}

async function listGrants(sql: postgres.Sql, target: string): Promise<void> {
  const rows = await sql<
    Array<{
      email: string;
      tier: string;
      reason: string;
      granted_by: string;
      expires_at: Date | null;
      revoked_at: Date | null;
      live: boolean;
    }>
  >`
    SELECT email, tier, reason, granted_by, expires_at, revoked_at,
           (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS live
    FROM entitlement_grants
    ORDER BY live DESC, created_at DESC
  `;
  if (rows.length === 0) {
    console.log(`No grants on ${target}.`);
    return;
  }
  console.log(`Grants on ${target}:\n`);
  for (const row of rows) {
    const state = row.revoked_at
      ? `revoked ${row.revoked_at.toISOString().slice(0, 10)}`
      : row.expires_at
        ? `${row.live ? 'until' : 'expired'} ${row.expires_at.toISOString().slice(0, 10)}`
        : 'permanent';
    console.log(
      `  ${row.live ? '●' : '○'} ${row.email.padEnd(34)} ${row.tier.padEnd(5)} ${state.padEnd(22)} ${row.reason} (${row.granted_by})`,
    );
  }
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} [y/N] `)).trim().toLowerCase() === 'y';
  } finally {
    rl.close();
  }
}

main().catch((err: unknown) => {
  console.error('✗ grant-tier failed');
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
