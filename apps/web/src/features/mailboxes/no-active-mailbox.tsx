'use client';

import Link from 'next/link';
import { Button, EmptyState, tokens } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import { useLogout } from '@/features/auth/api/use-logout';

const { color, font } = tokens;

/**
 * No-active-mailbox gate (D116).
 *
 * Shown by the app shell when `me.activeMailboxId` is null — i.e. the
 * user disconnected their last (or only) active mailbox. Without this,
 * every read 409s `NO_ACTIVE_MAILBOX` and the dashboard renders broken.
 *
 * It's a full-screen takeover (the sidebar/nav are meaningless with no
 * data) offering the one action that resolves the state: connect or
 * reconnect a Gmail account. Reconnect uses the same OAuth flow as
 * "connect another" — Google's account chooser lets the user pick the
 * disconnected account, which `addMailbox` reactivates.
 *
 * Split into a presentational `NoActiveMailboxView` (props only, so
 * Storybook + tests drive every branch without mounting AuthProvider)
 * and this thin container that wires `useAuth` + `useLogout` (D198).
 */
export function NoActiveMailbox() {
  const { me } = useAuth();
  const logout = useLogout();

  const disconnected = me.mailboxes.filter((m) => m.status === 'disconnected');
  const deletionInProgressEmails = disconnected
    .filter((m) =>
      ['deletion_pending', 'deleting', 'deletion_delayed'].includes(m.indexedDataState ?? ''),
    )
    .map((m) => m.email);
  const reconnectable = disconnected.filter((m) => !deletionInProgressEmails.includes(m.email));
  const deletedDataEmails = reconnectable
    .filter((m) => m.indexedDataState === 'deleted')
    .map((m) => m.email);
  const disconnectedEmails = reconnectable.map((m) => m.email);

  return (
    <NoActiveMailboxView
      disconnectedEmails={disconnectedEmails}
      deletionInProgressEmails={deletionInProgressEmails}
      deletedDataEmails={deletedDataEmails}
      signingOut={logout.isPending}
      onConnect={() => {
        const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
        window.location.assign(`${apiBase}/api/auth/google/connect-mailbox/start`);
      }}
      onSignOut={() => logout.mutate()}
    />
  );
}

export interface NoActiveMailboxViewProps {
  /** Emails of disconnected accounts; non-empty drives the "reconnect" framing. */
  disconnectedEmails: string[];
  /** Reconnect is blocked until these durable purge requests complete. */
  deletionInProgressEmails?: string[];
  /** Reconnecting these mailboxes builds a fresh index; prior history was deleted. */
  deletedDataEmails?: string[];
  signingOut: boolean;
  onConnect: () => void;
  onSignOut: () => void;
}

export function NoActiveMailboxView({
  disconnectedEmails,
  deletionInProgressEmails = [],
  deletedDataEmails = [],
  signingOut,
  onConnect,
  onSignOut,
}: NoActiveMailboxViewProps) {
  const hasDisconnected = disconnectedEmails.length > 0;
  const deletionInProgress = deletionInProgressEmails.length > 0;
  const onlyDeletedData =
    hasDisconnected && disconnectedEmails.every((email) => deletedDataEmails.includes(email));

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
      <EmptyState
        icon={<span aria-hidden>📭</span>}
        title="No active mailbox"
        description={
          hasDisconnected
            ? onlyDeletedData
              ? 'This mailbox’s indexed data was deleted. Reconnect to build a new index from Gmail; the deleted history does not return.'
              : 'You disconnected your last Gmail account. Reconnect it to pick up where you left off — its indexed history is preserved.'
            : deletionInProgress
              ? 'Indexed data deletion is in progress. Gmail access stays disconnected, and reconnect becomes available after deletion completes.'
              : 'Connect a Gmail account to review your inbox by sender.'
        }
        action={
          deletionInProgress && !hasDisconnected ? undefined : (
            <Button tone="primary" onClick={onConnect}>
              {hasDisconnected ? 'Reconnect Gmail' : 'Connect a Gmail account'}
            </Button>
          )
        }
      />

      {hasDisconnected && (
        <p
          style={{
            marginTop: 14,
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            letterSpacing: '0.02em',
          }}
        >
          Disconnected: {disconnectedEmails.join(' · ')}
        </p>
      )}

      {deletionInProgress && (
        <p
          role="status"
          style={{
            marginTop: 14,
            fontFamily: font.mono,
            fontSize: 11,
            color: color.fgMuted,
            letterSpacing: '0.02em',
          }}
        >
          Deleting indexed data: {deletionInProgressEmails.join(' · ')}
        </p>
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
        <span>Not reconnecting?</span>
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
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: 13,
          textDecoration: 'underline',
        }}
      >
        Sign out
      </button>
    </main>
  );
}

const gateLinkStyle = {
  color: color.primary,
  textDecoration: 'none',
  fontWeight: 500,
} as const;
