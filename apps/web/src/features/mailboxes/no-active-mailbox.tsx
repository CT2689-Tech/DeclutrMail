'use client';

import Link from 'next/link';
import { Button, EmptyState, tokens } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { useLogout } from '@/features/auth/api/use-logout';
import { startMailboxConnect, startMailboxReactivation } from './connect-mailbox-url';

const { color, font } = tokens;

/**
 * No-active-mailbox gate (D116).
 *
 * Shown by the app shell when `me.activeMailboxId` is null — i.e. the
 * user disconnected their last (or only) active mailbox. Without this,
 * every read 409s `NO_ACTIVE_MAILBOX` and the dashboard renders broken.
 *
 * It's a full-screen takeover (the sidebar/nav are meaningless with no
 * data) offering the action that resolves the state: connect a Gmail
 * account or reactivate an exact disconnected mailbox. Reactivation is
 * mailbox-bound so choosing the wrong Google identity cannot silently
 * restore a different account.
 *
 * Split into a presentational `NoActiveMailboxView` (props only, so
 * Storybook + tests drive every branch without mounting AuthProvider)
 * and this thin container that wires `useAuth` + `useLogout` (D198).
 */
export function NoActiveMailbox() {
  const { me } = useAuth();
  const logout = useLogout();

  const disconnectedMailboxes = me.mailboxes
    .filter((m) => m.status === 'disconnected')
    .map(({ id, email, indexedDataState }) => ({
      id,
      email,
      indexedDataState: indexedDataState ?? 'retained',
    }));

  return (
    <NoActiveMailboxView
      disconnectedMailboxes={disconnectedMailboxes}
      signingOut={logout.isPending}
      onConnect={() => startMailboxConnect()}
      onReactivate={(mailboxId) => startMailboxReactivation(mailboxId)}
      onSignOut={() => logout.mutate()}
    />
  );
}

export interface DisconnectedMailbox {
  /** Opaque mailbox identifier used only to bind the OAuth recovery request. */
  id: string;
  email: string;
  indexedDataState?: MeMailbox['indexedDataState'];
}

export interface NoActiveMailboxViewProps {
  /** Disconnected accounts available for exact, mailbox-bound reactivation. */
  disconnectedMailboxes: DisconnectedMailbox[];
  signingOut: boolean;
  onConnect: () => void;
  onReactivate: (mailboxId: string) => void;
  onSignOut: () => void;
}

export function NoActiveMailboxView({
  disconnectedMailboxes,
  signingOut,
  onConnect,
  onReactivate,
  onSignOut,
}: NoActiveMailboxViewProps) {
  const deletingMailboxes = disconnectedMailboxes.filter((mailbox) =>
    ['deletion_pending', 'deleting', 'deletion_delayed'].includes(mailbox.indexedDataState ?? ''),
  );
  const reconnectableMailboxes = disconnectedMailboxes.filter(
    (mailbox) => !deletingMailboxes.includes(mailbox),
  );
  const hasDisconnected = disconnectedMailboxes.length > 0;
  const onlyDisconnected =
    reconnectableMailboxes.length === 1 && deletingMailboxes.length === 0
      ? reconnectableMailboxes[0]
      : undefined;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        background: color.bg,
        fontFamily: font.sans,
      }}
    >
      <div style={{ width: '100%', maxWidth: 560 }}>
        <EmptyState
          icon={<span aria-hidden>📭</span>}
          title="No active mailbox"
          description={
            onlyDisconnected ? (
              <>
                <span
                  style={{
                    display: 'block',
                    color: color.fg,
                    fontFamily: font.mono,
                    overflowWrap: 'anywhere',
                  }}
                >
                  {onlyDisconnected.email}
                </span>
                <span style={{ display: 'block', marginTop: 4 }}>
                  {onlyDisconnected.indexedDataState === 'deleted'
                    ? 'Reconnect to build a new index from Gmail. Deleted history does not return.'
                    : 'Reconnect to pick up where you left off. Your sender history is preserved.'}
                </span>
              </>
            ) : reconnectableMailboxes.length > 0 ? (
              'Choose the Gmail account you want to reconnect. Your sender history is preserved.'
            ) : deletingMailboxes.length > 0 ? (
              'Indexed data deletion is in progress. Gmail access stays disconnected; reconnect becomes available after deletion completes.'
            ) : (
              'Connect a Gmail account to start cleaning up your inbox.'
            )
          }
          action={
            onlyDisconnected ? (
              <Button
                tone="primary"
                ariaLabel={`Reconnect ${onlyDisconnected.email}`}
                onClick={() => onReactivate(onlyDisconnected.id)}
                style={touchButtonStyle}
              >
                Reconnect Gmail
              </Button>
            ) : reconnectableMailboxes.length > 0 ? (
              <ul
                aria-label="Disconnected Gmail accounts"
                style={{
                  width: 'min(420px, 100%)',
                  margin: '2px 0 0',
                  padding: 0,
                  display: 'grid',
                  gap: 8,
                  listStyle: 'none',
                }}
              >
                {reconnectableMailboxes.map((mailbox) => (
                  <li
                    key={mailbox.id}
                    style={{
                      minWidth: 0,
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      border: `1px solid ${color.line}`,
                      borderRadius: 8,
                      background: color.bg,
                    }}
                  >
                    <span
                      style={{
                        minWidth: 0,
                        color: color.fg,
                        fontFamily: font.mono,
                        fontSize: 12,
                        overflowWrap: 'anywhere',
                        textAlign: 'left',
                      }}
                    >
                      {mailbox.email}
                    </span>
                    <Button
                      tone="primary"
                      size="sm"
                      ariaLabel={`Reconnect ${mailbox.email}`}
                      onClick={() => onReactivate(mailbox.id)}
                      style={{ ...touchButtonStyle, flexShrink: 0 }}
                    >
                      Reconnect
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Button tone="primary" onClick={onConnect} style={touchButtonStyle}>
                Connect a Gmail account
              </Button>
            )
          }
        />
      </div>

      {deletingMailboxes.length > 0 && (
        <p role="status" style={{ margin: '14px 0 0', color: color.fgMuted, fontSize: 12 }}>
          Deleting indexed data: {deletingMailboxes.map((mailbox) => mailbox.email).join(' · ')}
        </p>
      )}

      {hasDisconnected && (
        <Button
          tone="default"
          onClick={onConnect}
          style={{
            marginTop: 16,
            maxWidth: '100%',
            whiteSpace: 'normal',
            ...touchButtonStyle,
          }}
        >
          Connect a different Gmail account
        </Button>
      )}

      {/* Escape hatches that don't need a mailbox: account (data export +
          deletion, D216) and billing/refunds (D121) are workspace-level,
          so they stay reachable even with nothing connected. */}
      <p
        style={{
          marginTop: 20,
          fontSize: 13,
          color: color.fgMuted,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <span>{hasDisconnected ? 'Not reconnecting?' : 'Need something else?'}</span>
        <Link href="/settings#account" style={gateLinkStyle}>
          Manage account
        </Link>
        <span aria-hidden style={{ color: color.line }}>
          ·
        </span>
        <Link href="/billing" style={gateLinkStyle}>
          Billing
        </Link>
      </p>

      <button
        type="button"
        disabled={signingOut}
        onClick={onSignOut}
        style={{
          marginTop: 22,
          background: 'transparent',
          border: 'none',
          color: color.fgMuted,
          cursor: signingOut ? 'not-allowed' : 'pointer',
          fontFamily: font.sans,
          fontSize: 13,
          minHeight: 44,
          opacity: signingOut ? 0.6 : 1,
          padding: '0 8px',
          textDecoration: 'underline',
        }}
      >
        Sign out
      </button>
    </main>
  );
}

const gateLinkStyle = {
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  color: color.primary,
  textDecoration: 'none',
  fontWeight: 500,
} as const;

const touchButtonStyle = {
  height: 'auto',
  minHeight: 44,
} as const;
