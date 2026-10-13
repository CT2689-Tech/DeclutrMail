/**
 * Data operations for `pnpm grant-tier`.
 *
 * A manual Backlog Pass is an `entitlement_grants` row with
 * `source = 'pass'` and `provider` NULL. It never calls a payment
 * provider. Refund and revoke paths that talk to a provider must
 * ignore these rows; the helpers here are the ones those paths share.
 */

import { randomUUID } from 'node:crypto';

import { OFFERS } from '../packages/shared/src/entitlements/pricing.config.js';
import { TIER_RANK } from '../packages/shared/src/entitlements/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Tiers a comp may grant. Free is not a comp, and Team/Enterprise are unbuilt. */
export const GRANTABLE = ['plus', 'pro'] as const;
export type GrantableTier = (typeof GRANTABLE)[number];

export type GrantCommand = 'list' | 'grant' | 'revoke' | 'grant-pass';

export interface GrantArgs {
  command: GrantCommand;
  email: string | null;
  tier: GrantableTier | null;
  reason: string | null;
  grantedBy: string;
  expiresAt: Date | null;
  prod: boolean;
}

export type ParsedGrantArgs = { ok: true; args: GrantArgs } | { ok: false; message: string };

/**
 * Tagged-template query. postgres.js satisfies this; tests adapt PGlite
 * to the same shape so the SQL the script runs is the SQL the tests run.
 */
export interface SqlQuery {
  <T extends readonly object[]>(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<T>;
}

interface LivePassRow {
  provider: string | null;
  provider_transaction_id: string | null;
  expires_at: Date | string | null;
  reason: string;
}

export type ManualPassPreview =
  | { status: 'ready' }
  | {
      status: 'already_manual';
      expiresAt: Date | null;
      providerTransactionId: string | null;
      reason: string;
    }
  | {
      status: 'blocked_paid';
      provider: string;
      expiresAt: Date | null;
      providerTransactionId: string | null;
    };

export type ManualPassGrantResult =
  | {
      status: 'granted';
      expiresAt: Date;
      providerTransactionId: string;
    }
  | Exclude<ManualPassPreview, { status: 'ready' }>;

export interface RevokedGrantRow {
  tier: string;
  source: string;
}

export interface UntouchedPaidPass {
  provider: string;
  expiresAt: Date | null;
  providerTransactionId: string | null;
}

export type OperatorRevokeResult =
  | { status: 'revoked'; rows: RevokedGrantRow[]; untouchedPaidPass: UntouchedPaidPass | null }
  | { status: 'none' }
  | ({ status: 'paid_pass_untouched' } & UntouchedPaidPass);

export interface ListedGrant {
  email: string;
  tier: string;
  reason: string;
  grantedBy: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  source: string;
  provider: string | null;
  live: boolean;
}

export function parseGrantArgs(argv: string[]): ParsedGrantArgs {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match?.[1]) flags.set(match[1], match[2] ?? 'true');
    else positional.push(arg);
  }

  const command = positional[0];
  if (
    command !== 'list' &&
    command !== 'grant' &&
    command !== 'revoke' &&
    command !== 'grant-pass'
  ) {
    return {
      ok: false,
      message: `unknown command ${command ? `"${command}"` : '(none given)'}`,
    };
  }

  const prod = flags.get('prod') === 'true';
  if (command === 'list') {
    return {
      ok: true,
      args: {
        command,
        email: null,
        tier: null,
        reason: null,
        grantedBy: '',
        expiresAt: null,
        prod,
      },
    };
  }

  const email = positional[1];
  if (!email || !email.includes('@')) return { ok: false, message: 'an email address is required' };

  if (command === 'revoke') {
    return {
      ok: true,
      args: { command, email, tier: null, reason: null, grantedBy: '', expiresAt: null, prod },
    };
  }

  const reason = flags.get('reason');
  if (!reason || reason === 'true') {
    return { ok: false, message: '--reason="why this grant exists" is required' };
  }
  const grantedBy = flags.get('by') ?? process.env.USER ?? 'founder';

  if (command === 'grant-pass') {
    if (flags.has('expires')) {
      return {
        ok: false,
        message: 'grant-pass uses the Backlog Pass duration; --expires is not accepted',
      };
    }
    return {
      ok: true,
      args: {
        command,
        email,
        tier: 'plus',
        reason,
        grantedBy,
        expiresAt: null,
        prod,
      },
    };
  }

  const tier = positional[2];
  if (!isGrantable(tier)) {
    return { ok: false, message: `tier must be one of ${GRANTABLE.join(', ')}` };
  }

  let expiresAt: Date | null = null;
  const rawExpiry = flags.get('expires');
  if (rawExpiry && rawExpiry !== 'true') {
    const parsed = new Date(`${rawExpiry}T23:59:59Z`);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, message: `--expires must be YYYY-MM-DD, got "${rawExpiry}"` };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ok: false, message: `--expires is in the past (${rawExpiry})` };
    }
    expiresAt = parsed;
  }

  return {
    ok: true,
    args: { command, email, tier, reason, grantedBy, expiresAt, prod },
  };
}

function isGrantable(value: string | undefined): value is GrantableTier {
  return value !== undefined && (GRANTABLE as readonly string[]).includes(value);
}

/** Label a list row so a manual Pass is visible beside comps and paid Passes. */
export function grantKindLabel(row: { source: string; provider: string | null }): string {
  if (row.source === 'pass' && row.provider == null) return 'pass manual';
  if (row.source === 'pass') return `pass ${row.provider}`;
  return row.source;
}

export async function previewManualPass(sql: SqlQuery, email: string): Promise<ManualPassPreview> {
  const live = await livePasses(sql, email);
  const paid = live.find((row) => row.provider != null);
  if (paid) {
    return {
      status: 'blocked_paid',
      provider: paid.provider ?? 'paddle',
      expiresAt: asDate(paid.expires_at),
      providerTransactionId: paid.provider_transaction_id,
    };
  }
  const manual = live.find((row) => row.provider == null);
  if (manual) {
    return {
      status: 'already_manual',
      expiresAt: asDate(manual.expires_at),
      providerTransactionId: manual.provider_transaction_id,
      reason: manual.reason,
    };
  }
  return { status: 'ready' };
}

/**
 * Insert one manual Backlog Pass. A second call while the first is live
 * does not extend it. A live paid Pass blocks the insert.
 */
export async function grantManualPass(
  sql: SqlQuery,
  input: {
    email: string;
    reason: string;
    grantedBy: string;
    now?: Date;
    transactionId?: string;
  },
): Promise<ManualPassGrantResult> {
  const preview = await previewManualPass(sql, input.email);
  if (preview.status !== 'ready') return preview;

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + OFFERS.backlogPass.durationDays * DAY_MS);
  const providerTransactionId = input.transactionId ?? `manual-pass:${randomUUID()}`;
  await sql`
    INSERT INTO entitlement_grants (
      email, tier, reason, granted_by, expires_at, source, provider, provider_transaction_id
    )
    VALUES (
      ${input.email},
      'plus',
      ${input.reason},
      ${input.grantedBy},
      ${expiresAt.toISOString()},
      'pass',
      NULL,
      ${providerTransactionId}
    )
  `;
  return { status: 'granted', expiresAt, providerTransactionId };
}

/**
 * Clear live comps and live manual Passes. A Pass with a provider is
 * a payment-provider row and is never updated here.
 */
export async function revokeOperatorGrants(
  sql: SqlQuery,
  email: string,
): Promise<OperatorRevokeResult> {
  const revoked = await sql<{ tier: string; source: string }[]>`
    UPDATE entitlement_grants
    SET revoked_at = now(), updated_at = now()
    WHERE email = ${email}
      AND revoked_at IS NULL
      AND (
        source = 'comp'
        OR (source = 'pass' AND provider IS NULL)
      )
    RETURNING tier, source
  `;
  const paid = await livePaidPass(sql, email);
  if (revoked.length === 0) {
    if (!paid) return { status: 'none' };
    return { status: 'paid_pass_untouched', ...paid };
  }
  return { status: 'revoked', rows: [...revoked], untouchedPaidPass: paid };
}

/** A revoked Pass counts as a prior refund only when a provider recorded it. */
export async function hasRevokedProviderPass(sql: SqlQuery, email: string): Promise<boolean> {
  const [row] = await sql<{ found: boolean | string }[]>`
    SELECT true AS found
    FROM entitlement_grants
    WHERE email = ${email}
      AND source = 'pass'
      AND revoked_at IS NOT NULL
      AND provider IS NOT NULL
    LIMIT 1
  `;
  return asBool(row?.found);
}

export async function listGrants(sql: SqlQuery): Promise<ListedGrant[]> {
  const rows = await sql<
    {
      email: string;
      tier: string;
      reason: string;
      granted_by: string;
      expires_at: Date | string | null;
      revoked_at: Date | string | null;
      source: string;
      provider: string | null;
      live: boolean | string;
    }[]
  >`
    SELECT email, tier, reason, granted_by, expires_at, revoked_at, source, provider,
           (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS live
    FROM entitlement_grants
    ORDER BY live DESC, created_at DESC
  `;
  return rows.map((row) => ({
    email: row.email,
    tier: row.tier,
    reason: row.reason,
    grantedBy: row.granted_by,
    expiresAt: asDate(row.expires_at),
    revokedAt: asDate(row.revoked_at),
    source: row.source,
    provider: row.provider,
    live: asBool(row.live),
  }));
}

async function livePasses(sql: SqlQuery, email: string): Promise<LivePassRow[]> {
  return sql<LivePassRow[]>`
    SELECT provider, provider_transaction_id, expires_at, reason
    FROM entitlement_grants
    WHERE email = ${email}
      AND source = 'pass'
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  `;
}

async function livePaidPass(sql: SqlQuery, email: string): Promise<UntouchedPaidPass | null> {
  const [row] = await sql<LivePassRow[]>`
    SELECT provider, provider_transaction_id, expires_at, reason
    FROM entitlement_grants
    WHERE email = ${email}
      AND source = 'pass'
      AND provider IS NOT NULL
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `;
  if (!row?.provider) return null;
  return {
    provider: row.provider,
    expiresAt: asDate(row.expires_at),
    providerTransactionId: row.provider_transaction_id,
  };
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

/** `ORDER BY <this> DESC LIMIT 1` — same manifest ranking the API uses. */
export function tierRankCase(column: string): string {
  const branches = Object.entries(TIER_RANK)
    .map(([tier, rank]) => `WHEN '${tier}' THEN ${rank}`)
    .join(' ');
  return `CASE ${column} ${branches} ELSE 0 END`;
}
