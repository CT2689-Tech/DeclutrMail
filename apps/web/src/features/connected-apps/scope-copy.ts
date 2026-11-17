import type { ConnectorScope } from '@declutrmail/shared/contracts';

/**
 * What each connector scope lets an app do, in the person's words
 * (docs/spec/mcp-connector.md §4). One line each, shown on the consent
 * page and beside each connected app.
 */
export const SCOPE_LABEL: Record<ConnectorScope, string> = {
  read: 'See your senders and subject lines',
  cleanup: 'Clean up, with your confirmation',
};

/** Stable order: reading before changing. */
export const SCOPE_ORDER: readonly ConnectorScope[] = ['read', 'cleanup'];

export function orderedScopes(scopes: readonly ConnectorScope[]): ConnectorScope[] {
  return SCOPE_ORDER.filter((scope) => scopes.includes(scope));
}

/** A registered app may have no name; say so plainly instead of inventing one. */
export function appDisplayName(appName: string | null): string {
  return appName?.trim() || 'Unnamed app';
}
