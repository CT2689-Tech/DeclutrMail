#!/usr/bin/env tsx
/**
 * scripts/grant-tier.ts
 *
 * Comp an email onto Plus or Pro, or grant a manual Backlog Pass —
 * the admin surface for `entitlement_grants`.
 *
 *   pnpm grant-tier list
 *   pnpm grant-tier grant <email> <tier> --reason="advisor" [--expires=2026-12-31]
 *   pnpm grant-tier grant-pass <email> --reason="support" [--by=name]
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
 * A manual Backlog Pass is the same table with `source = 'pass'`,
 * `provider` NULL, and a 30-day expiry from the pricing manifest. It
 * does not call a payment provider. `revoke` clears that row and comps,
 * and leaves a provider-backed Pass alone.
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
import {
  GRANTABLE,
  grantKindLabel,
  grantManualPass,
  listGrants,
  parseGrantArgs,
  previewManualPass,
  revokeOperatorGrants,
  tierRankCase,
  type GrantArgs,
  type ListedGrant,
  type SqlQuery,
} from './grant-tier-ops.js';

const LOCAL_DSN = 'postgresql://postgres:postgres@localhost:5432/declutrmail';

function usage(message: string): never {
  console.error(`✗ ${message}

Usage:
  pnpm grant-tier list [--prod]
  pnpm grant-tier grant <email> <${GRANTABLE.join('|')}> --reason="why" [--expires=YYYY-MM-DD] [--by=name] [--prod]
  pnpm grant-tier grant-pass <email> --reason="why" [--by=name] [--prod]
  pnpm grant-tier revoke <email> [--prod]`);
  process.exit(2);
}

async function main(): Promise<void> {
  const parsed = parseGrantArgs(process.argv.slice(2));
  if (!parsed.ok) usage(parsed.message);
  const args = parsed.args;

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
  const query = sql as unknown as SqlQuery;

  try {
    if (args.command === 'list') {
      await printGrants(query, target);
      return;
    }

    const email = args.email as string;

    if (args.command === 'grant-pass') {
      await runGrantPass(query, sql, args, email, target);
      return;
    }

    // Production writes are confirmed by hand. This grants or removes a
    // paid entitlement on a real account; the local DB needs no such
    // ceremony.
    if (args.prod && !(await confirm(`${args.command} ${args.email} on PRODUCTION?`))) {
      console.log('Aborted — nothing written.');
      return;
    }

    if (args.command === 'revoke') {
      const revoked = await revokeOperatorGrants(query, email);
      if (revoked.status === 'none') {
        console.log(`No live grant for ${email} on ${target} — nothing to revoke.`);
        return;
      }
      if (revoked.status === 'paid_pass_untouched') {
        console.log(`No manual grant for ${email} on ${target} — nothing to revoke.`);
        console.log(`  A live ${revoked.provider} Backlog Pass remains ${describePaid(revoked)}.`);
        return;
      }
      const kinds = revoked.rows.map((row) =>
        row.source === 'pass' ? 'manual Backlog Pass' : `${row.tier} comp`,
      );
      console.log(`✓ Revoked ${kinds.join(' and ')} for ${email} on ${target}.`);
      if (revoked.untouchedPaidPass) {
        console.log(
          `  A live ${revoked.untouchedPaidPass.provider} Backlog Pass remains ${describePaid(revoked.untouchedPaidPass)}.`,
        );
      }
    } else {
      await sql`
        INSERT INTO entitlement_grants (email, tier, reason, granted_by, expires_at, source)
        VALUES (${email}, ${args.tier as string}, ${args.reason as string}, ${args.grantedBy}, ${args.expiresAt?.toISOString() ?? null}, 'comp')
        ON CONFLICT (email) WHERE source = 'comp' DO UPDATE SET
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

async function runGrantPass(
  query: SqlQuery,
  sql: postgres.Sql,
  args: GrantArgs,
  email: string,
  target: string,
): Promise<void> {
  const preview = await previewManualPass(query, email);
  if (preview.status === 'already_manual') {
    console.log(
      `Already has a live manual Backlog Pass on ${target}${through(preview.expiresAt)} (${preview.providerTransactionId ?? 'no transaction id'}). Nothing written.`,
    );
    return;
  }
  if (preview.status === 'blocked_paid') {
    console.log(
      `Already has a live ${preview.provider} Backlog Pass on ${target}${through(preview.expiresAt)} (${preview.providerTransactionId ?? 'no transaction id'}). Nothing written.`,
    );
    return;
  }

  if (args.prod && !(await confirm(`grant-pass ${email} on PRODUCTION?`))) {
    console.log('Aborted — nothing written.');
    return;
  }

  const granted = await grantManualPass(query, {
    email,
    reason: args.reason as string,
    grantedBy: args.grantedBy,
  });
  if (granted.status !== 'granted') {
    console.log(`Nothing written for ${email} on ${target} (${granted.status}).`);
    return;
  }
  console.log(
    `✓ Manual Backlog Pass for ${email} on ${target}${through(granted.expiresAt)} (${granted.providerTransactionId}).`,
  );
  await applyToWorkspace(sql, email, target);
}

function through(expiresAt: Date | null): string {
  return expiresAt ? ` through ${expiresAt.toISOString().slice(0, 10)}` : '';
}

function describePaid(pass: {
  providerTransactionId: string | null;
  expiresAt: Date | null;
}): string {
  const id = pass.providerTransactionId ?? 'no transaction id';
  return pass.expiresAt
    ? `(${id}, through ${pass.expiresAt.toISOString().slice(0, 10)})`
    : `(${id})`;
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

async function printGrants(sql: SqlQuery, target: string): Promise<void> {
  const rows = await listGrants(sql);
  if (rows.length === 0) {
    console.log(`No grants on ${target}.`);
    return;
  }
  console.log(`Grants on ${target}:\n`);
  for (const row of rows) console.log(formatGrantLine(row));
}

function formatGrantLine(row: ListedGrant): string {
  const state = row.revokedAt
    ? `revoked ${row.revokedAt.toISOString().slice(0, 10)}`
    : row.expiresAt
      ? `${row.live ? 'until' : 'expired'} ${row.expiresAt.toISOString().slice(0, 10)}`
      : 'permanent';
  return `  ${row.live ? '●' : '○'} ${row.email.padEnd(34)} ${row.tier.padEnd(5)} ${grantKindLabel(row).padEnd(14)} ${state.padEnd(22)} ${row.reason} (${row.grantedBy})`;
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
