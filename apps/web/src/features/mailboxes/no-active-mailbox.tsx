'use client';

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

  const disconnectedEmails = me.mailboxes
    .filter((m) => m.status === 'disconnected')
    .map((m) => m.email);

  return (
    <NoActiveMailboxView
      disconnectedEmails={disconnectedEmails}
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
  signingOut: boolean;
  onConnect: () => void;
  onSignOut: () => void;
}

export function NoActiveMailboxView({
  disconnectedEmails,
  signingOut,
  onConnect,
  onSignOut,
}: NoActiveMailboxViewProps) {
  const hasDisconnected = disconnectedEmails.length > 0;

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
            ? 'You disconnected your last Gmail account. Reconnect it to pick up where you left off — your sender history is preserved.'
            : 'Connect a Gmail account to start cleaning up your inbox.'
        }
        action={
          <Button tone="primary" onClick={onConnect}>
            {hasDisconnected ? 'Reconnect Gmail' : 'Connect a Gmail account'}
          </Button>
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
