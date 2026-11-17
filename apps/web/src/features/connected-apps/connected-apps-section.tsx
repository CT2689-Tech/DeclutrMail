'use client';

import { useEffect, useState } from 'react';
import { Button, toast, tokens } from '@declutrmail/shared';
import type { ConnectedApp } from '@declutrmail/shared/contracts';

import { formatDate } from '@/features/account-deletion/date-format';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import { SettingsGroup, SettingsRow, SettingsRowStatus } from '@/features/settings/settings-list';
import {
  isConnectorUnavailable,
  useConnectedApps,
  useDisconnectApp,
} from './api/use-connected-apps';
import { SCOPE_LABEL, appDisplayName, orderedScopes } from './scope-copy';

const { color, text } = tokens;

export type ConnectedAppsGroupState =
  { kind: 'error'; onRetry: () => void } | { kind: 'ready'; apps: readonly ConnectedApp[] };

/**
 * Settings → Connected apps: the assistants and tools that can act for
 * this person through DeclutrMail, each with its own Disconnect
 * (docs/spec/mcp-connector.md §4).
 *
 * States: error (+retry) · empty · list · disconnecting · disconnect
 * failed. There is no loading row: until the first answer arrives the
 * section may not exist at all (the connector can be switched off), so
 * it appears once, already in its real state. It owns its query, so a
 * failure here never decides whether the rest of Settings renders.
 */
export function ConnectedAppsGroup({
  state,
  timeZone,
  pendingId,
  failedAppName,
  onDisconnect,
}: {
  state: ConnectedAppsGroupState;
  timeZone: string;
  /** The grant whose Disconnect is in flight. */
  pendingId: string | null;
  /** Set when the last Disconnect could not be confirmed. */
  failedAppName: string | null;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  return (
    <SettingsGroup
      id="connected-apps"
      title="Connected apps"
      testId="settings-connected-apps"
      footer={
        failedAppName != null ? (
          <p role="alert" style={{ margin: '8px 0 0', fontSize: text.sm, color: color.dangerText }}>
            Could not disconnect {failedAppName}. Try again.
          </p>
        ) : undefined
      }
    >
      {state.kind !== 'ready' ? (
        <SettingsRowStatus
          state={state}
          loadingLabel="Loading connected apps…"
          errorLabel="Could not load connected apps."
        />
      ) : state.apps.length === 0 ? (
        <SettingsRow label="No apps connected" />
      ) : (
        state.apps.map((app) => {
          const name = appDisplayName(app.appName);
          const busy = pendingId === app.id;
          return (
            <SettingsRow
              key={app.id}
              label={name}
              detail={
                <>
                  {orderedScopes(app.scopes)
                    .map((scope) => SCOPE_LABEL[scope])
                    .join(' · ')}
                  <br />
                  Connected {formatDate(app.connectedAt, timeZone)}
                  {' · '}
                  {app.lastUsedAt
                    ? `Last used ${formatDate(app.lastUsedAt, timeZone)}`
                    : 'Not used yet'}
                </>
              }
            >
              <Button
                tone="danger"
                size="sm"
                disabled={busy}
                ariaLabel={`Disconnect ${name}`}
                onClick={() => onDisconnect(app)}
              >
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </SettingsRow>
          );
        })
      )}
    </SettingsGroup>
  );
}

/** The live section mounted in Settings. Renders nothing while the connector is off. */
export function ConnectedAppsSection() {
  const apps = useConnectedApps();
  const disconnect = useDisconnectApp();
  const timeZone = useUserTimeZone();
  const [failedAppName, setFailedAppName] = useState<string | null>(null);
  // The shell can fill this query before this subtree hydrates. Match the
  // server's render on the first client render, then show cached data.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Connector switched off for this deployment: a designed state, not an error.
  if (mounted && apps.isError && isConnectorUnavailable(apps.error)) return null;
  // Nothing to show until the first answer says whether the section exists.
  if (!mounted || apps.isPending) return null;

  return (
    <ConnectedAppsGroup
      state={
        apps.isError
          ? { kind: 'error', onRetry: () => void apps.refetch() }
          : { kind: 'ready', apps: apps.data.apps }
      }
      timeZone={timeZone}
      pendingId={disconnect.isPending ? (disconnect.variables ?? null) : null}
      failedAppName={failedAppName}
      onDisconnect={(app) => {
        const name = appDisplayName(app.appName);
        setFailedAppName(null);
        disconnect.mutate(app.id, {
          onSuccess: () => toast(`Disconnected ${name}.`, 'success'),
          onError: () => setFailedAppName(name),
        });
      }}
    />
  );
}
