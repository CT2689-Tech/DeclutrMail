'use client';

import { useEffect, useState } from 'react';
import { Button, toast } from '@declutrmail/shared';
import type { ConnectedApp } from '@declutrmail/shared/contracts';

import { formatDate } from '@/features/account-deletion/date-format';
import { useUserTimeZone } from '@/features/auth/api/use-me';
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowStatus,
  SettingsSaveError,
} from '@/features/settings/settings-list';
import { ApiError } from '@/lib/api/client';
import {
  isConnectorUnavailable,
  useConnectedApps,
  useDisconnectApp,
} from './api/use-connected-apps';
import { SCOPE_LABEL, appDisplayName, orderedScopes } from './scope-copy';

const SECTION_ID = 'connected-apps';

export type ConnectedAppsGroupState =
  { kind: 'error'; onRetry: () => void } | { kind: 'ready'; apps: readonly ConnectedApp[] };

/**
 * Settings → Connected apps: the assistants and tools that can act for
 * this person through DeclutrMail, each with its own Disconnect
 * (docs/spec/mcp-connector.md §4).
 *
 * States: error (+retry) · empty · list · disconnecting · disconnect
 * unconfirmed. There is no loading row: until the first answer arrives
 * the section may not exist at all (the connector can be switched off),
 * so it appears once, already in its real state. It owns its query, so
 * a failure here never decides whether the rest of Settings renders.
 *
 * One Disconnect runs at a time: while it is in flight every row's
 * button is unavailable (still focusable), so a second click can never
 * hide the first one's outcome.
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
  /** The grant whose Disconnect is in flight; every row is locked meanwhile. */
  pendingId: string | null;
  /** Set while the last Disconnect is unconfirmed and that app is still listed. */
  failedAppName: string | null;
  onDisconnect: (app: ConnectedApp) => void;
}) {
  return (
    <SettingsGroup
      id={SECTION_ID}
      title="Connected apps"
      testId="settings-connected-apps"
      footer={
        failedAppName != null ? (
          // An error does not prove the app is still connected: the server
          // can revoke it before the response is lost.
          <SettingsSaveError>
            Could not confirm {failedAppName} was disconnected. Try again.
          </SettingsSaveError>
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
                  {app.redirectHosts.length > 0 && (
                    <>
                      Returns to {app.redirectHosts.join(', ')}
                      <br />
                    </>
                  )}
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
                inert={pendingId !== null}
                ariaLabel={busy ? `Disconnecting ${name}` : `Disconnect ${name}`}
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
  const [failed, setFailed] = useState<{ id: string; name: string } | null>(null);
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
      // The list is read back after every attempt; once the app is no
      // longer in it, there is nothing left to retry and the line goes.
      failedAppName={
        failed !== null && apps.data?.apps.some((app) => app.id === failed.id) ? failed.name : null
      }
      onDisconnect={(app) => {
        const name = appDisplayName(app.appName);
        setFailed(null);
        disconnect.mutate(app.id, {
          onSuccess: () => {
            toast(`Disconnected ${name}.`, 'success');
            // The row (and the button that had focus) is about to go.
            const section = document.getElementById(SECTION_ID);
            const active = document.activeElement;
            if (section && (active === document.body || section.contains(active))) {
              section.focus({ preventScroll: true });
            }
          },
          // A 404 is the list being stale (or the connector switched off):
          // nothing to retry, and the refetch shows the truth.
          onError: (error) => {
            if (!(error instanceof ApiError && error.status === 404)) {
              setFailed({ id: app.id, name });
            }
          },
        });
      }}
    />
  );
}
