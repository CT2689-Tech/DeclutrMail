/**
 * Billing tiers (D19 5-tier ladder), ordered low → high. Mirrors the
 * `workspace_tier` pg_enum (packages/db/schema/workspaces.ts) — the DB
 * enum is append-only and declared explicitly in its migration; this is
 * the shared vocabulary both sides agree on, not a code-gen source.
 *
 * The first three rungs are exactly the `ACTION_TIERS` the Action
 * Registry gates verbs on (a capability never requires team/enterprise);
 * an invariant test pins that prefix relationship.
 */
export const TIER_IDS = ['free', 'plus', 'pro', 'team', 'enterprise'] as const;
export type TierId = (typeof TIER_IDS)[number];
