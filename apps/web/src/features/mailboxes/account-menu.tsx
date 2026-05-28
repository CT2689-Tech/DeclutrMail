'use client';

import { useEffect, useRef, useState } from 'react';
import { tokens, toast } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import { useLogout } from '@/features/auth/api/use-logout';
import { useDisconnectMailbox } from './api/use-disconnect-mailbox';
import { useSetActiveMailbox } from './api/use-set-active-mailbox';

const { color, font } = tokens;

/**
 * Header account menu (D116 surface — partial).
 *
 * Lists connected mailbox accounts, lets the user pick the active one,
 * disconnect a mailbox, connect another Google account, or sign out.
 *
 * Disconnect is two-click — the first click reveals a confirm row that
 * makes the destructive action explicit. The Google revoke happens
 * server-side (`MailboxAccountsService.disconnect`) so by the time the
 * toast fires the upstream refresh token is invalid.
 *
 * "Connect another" is a hard navigation to the OAuth start endpoint;
 * the BE clears the active-mailbox cookie path and the consent flow
 * appends the new account on success.
 */
export function AccountMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const setActive = useSetActiveMailbox();
  const disconnect = useDisconnectMailbox();
  const logout = useLogout();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // D205 connect-mailbox flow: adds (or reactivates) a Gmail account on
  // the CURRENT workspace without re-creating the user or re-issuing
  // session cookies. Hard navigation to the OAuth start endpoint.
  function connectAnother() {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
    window.location.assign(`${apiBase}/api/auth/google/connect-mailbox/start`);
  }

  const activeMailbox =
    me.mailboxes.find((m) => m.id === me.activeMailboxId) ??
    me.mailboxes.find((m) => m.status === 'active');
  const activeLabel = activeMailbox?.email ?? me.user.email;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={activeLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          height: 28,
          background: 'transparent',
          border: `1px solid ${color.border}`,
          borderRadius: 14,
          color: color.fg,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: 12,
          maxWidth: 220,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 18,
            height: 18,
            borderRadius: 9999,
            background: color.primary,
            color: '#fff',
            display: 'inline-grid',
            placeItems: 'center',
            fontSize: 10,
            fontWeight: 600,
          }}
        >
          {activeLabel.slice(0, 1).toUpperCase()}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{activeLabel}</span>
        <span aria-hidden style={{ opacity: 0.6 }}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            minWidth: 260,
            background: color.card,
            border: `1px solid ${color.border}`,
            borderRadius: 10,
            boxShadow: '0 6px 22px rgba(0,0,0,0.08)',
            padding: 8,
            fontFamily: font.sans,
            fontSize: 13,
            zIndex: 90,
          }}
        >
          <div
            style={{
              padding: '4px 8px',
              fontFamily: font.mono,
              fontSize: 9.5,
              textTransform: 'uppercase',
              letterSpacing: '0.14em',
              color: color.fgMuted,
            }}
          >
            Accounts
          </div>
          {me.mailboxes.length === 0 && (
            <div style={{ padding: '6px 8px', color: color.fgMuted }}>No mailboxes connected.</div>
          )}
          {me.mailboxes.map((m) => {
            const isActive = m.id === activeMailbox?.id;
            const isDisconnected = m.status === 'disconnected';
            const isPending = pendingDisconnect === m.id;
            return (
              <div key={m.id} style={{ borderTop: `1px dashed ${color.lineSoft}` }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    // Highlight the active mailbox so it reads as the
                    // current selection (not just a ✓) — the switch
                    // button is inert on the active row, which otherwise
                    // looked like "can't select it".
                    background: isActive ? color.primarySoft : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    disabled={isDisconnected || setActive.isPending}
                    onClick={() => {
                      if (isActive) return;
                      setActive.mutate(m.id, {
                        onSuccess: () => setOpen(false),
                      });
                    }}
                    style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: isDisconnected ? color.fgMuted : color.fg,
                      cursor: isDisconnected ? 'not-allowed' : 'pointer',
                      fontFamily: font.sans,
                      fontSize: 13,
                      textAlign: 'left',
                    }}
                  >
                    <span aria-hidden style={{ width: 14, color: color.primary }}>
                      {isActive ? '✓' : ' '}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {m.email}
                    </span>
                    {isActive && !isDisconnected && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          color: color.primary,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Active
                      </span>
                    )}
                    {isDisconnected && (
                      <span style={{ fontSize: 10, color: color.fgMuted }}>disconnected</span>
                    )}
                    {/* Per-mailbox initial-sync state (D116). `ready`/null
                        render nothing — they're the steady state. */}
                    {!isDisconnected && m.readiness && m.readiness !== 'ready' && (
                      <span
                        style={{
                          fontSize: 10,
                          color: m.readiness === 'failed' ? color.red : color.fgMuted,
                        }}
                      >
                        {m.readiness === 'failed' ? 'sync failed' : 'syncing…'}
                      </span>
                    )}
                  </button>
                  {!isDisconnected ? (
                    <button
                      type="button"
                      onClick={() => setPendingDisconnect(isPending ? null : m.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: color.fgMuted,
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '2px 6px',
                      }}
                    >
                      {isPending ? 'Cancel' : 'Disconnect'}
                    </button>
                  ) : (
                    // Reconnect a disconnected account — same OAuth flow as
                    // "connect another"; Google's chooser lets the user pick
                    // this account, which `addMailbox` reactivates (D116).
                    <button
                      type="button"
                      onClick={connectAnother}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: color.primary,
                        cursor: 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 6px',
                      }}
                    >
                      Reconnect
                    </button>
                  )}
                </div>
                {isPending && (
                  <div
                    style={{
                      padding: '6px 12px 10px 28px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      color: color.fgMuted,
                    }}
                  >
                    <span>Disconnect this Gmail account?</span>
                    <button
                      type="button"
                      disabled={disconnect.isPending}
                      onClick={() => {
                        disconnect.mutate(m.id, {
                          onSuccess: () => {
                            setPendingDisconnect(null);
                            toast(`Disconnected ${m.email}.`, 'success');
                          },
                          onError: () => {
                            // A terminal 401 redirects to login via the
                            // apiClient; any other failure surfaces here
                            // so the click never silently no-ops.
                            toast(`Could not disconnect ${m.email}. Try again.`, 'danger');
                          },
                        });
                      }}
                      style={{
                        background: color.red,
                        color: '#fff',
                        border: 'none',
                        padding: '3px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div
            style={{
              borderTop: `1px solid ${color.border}`,
              marginTop: 6,
              paddingTop: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <button type="button" onClick={connectAnother} style={menuItemStyle()}>
              + Connect another Gmail account
            </button>
            <button
              type="button"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
              style={menuItemStyle()}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function menuItemStyle() {
  return {
    background: 'transparent',
    border: 'none',
    color: color.fg,
    cursor: 'pointer',
    fontFamily: font.sans,
    fontSize: 13,
    textAlign: 'left' as const,
    padding: '6px 8px',
    borderRadius: 6,
  };
}
