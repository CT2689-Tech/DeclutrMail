// @declutrmail/shared/contracts/connected-apps — the MCP connector's
// OAuth consent and Settings → Connected apps wire contract (ADR-0048
// rule 4, docs/spec/mcp-connector.md §4), shared by apps/api/src/oauth
// and apps/web/src/features/connected-apps.

import { z } from 'zod';

/**
 * What a connected app may ask for. `read` covers the read-only tools;
 * `cleanup` covers preview, apply, undo and protect — and every mail
 * change still needs the person's confirmation of that exact preview
 * (ADR-0048 rule 1).
 */
export const CONNECTOR_SCOPES = ['read', 'cleanup'] as const;
export const ConnectorScopeSchema = z.enum(CONNECTOR_SCOPES);
export type ConnectorScope = z.infer<typeof ConnectorScopeSchema>;

/** GET /api/oauth/interactions/:id/details — what the consent page shows. */
export const ConnectorConsentSchema = z.object({
  /** The app's self-declared name; null when it registered without one. */
  appName: z.string().nullable(),
  /** Host the person is sent back to after deciding — the app's verifiable identity. */
  redirectHost: z.string(),
  /** Only what the app requested (spec §4). */
  scopes: z.array(ConnectorScopeSchema),
  /** Addresses of the Gmail accounts the app would reach. */
  mailboxes: z.array(z.string()),
  /**
   * The DeclutrMail account deciding, so a person signed in as someone
   * else can tell before approving. Null from an API that predates it.
   */
  signedInAs: z.string().nullable().default(null),
  /** Why Approve cannot succeed for this account; null when it can. */
  blocked: z.enum(['not_available', 'deletion_pending']).nullable().default(null),
});
export type ConnectorConsent = z.infer<typeof ConnectorConsentSchema>;

/** POST …/approve and …/deny — where the browser goes next. */
export const ConnectorConsentResultSchema = z.object({
  redirectTo: z.string(),
});
export type ConnectorConsentResult = z.infer<typeof ConnectorConsentResultSchema>;

/** One row of Settings → Connected apps. */
export const ConnectedAppSchema = z.object({
  /** Grant id — the thing Disconnect revokes. */
  id: z.string(),
  /** The app's self-declared name; null when it registered without one. */
  appName: z.string().nullable(),
  /**
   * Hosts the app registered to send people back to — what tells two
   * apps with the same name apart.
   */
  redirectHosts: z.array(z.string()),
  scopes: z.array(ConnectorScopeSchema),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type ConnectedApp = z.infer<typeof ConnectedAppSchema>;

/** GET /api/oauth/grants. */
export const ConnectedAppsSchema = z.object({
  apps: z.array(ConnectedAppSchema),
});
export type ConnectedApps = z.infer<typeof ConnectedAppsSchema>;
