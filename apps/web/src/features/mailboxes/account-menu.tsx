'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { tokens, toast } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { useLogout } from '@/features/auth/api/use-logout';
import { useTier } from '@/features/auth/api/use-tier';
import { track } from '@/lib/posthog';
import { useDeleteMailboxIndexedData } from './api/use-delete-mailbox-indexed-data';
import { useDisconnectMailbox } from './api/use-disconnect-mailbox';
import { useSetActiveMailbox } from './api/use-set-active-mailbox';
import { MailboxDataControlsDialog } from './mailbox-data-controls-dialog';

const { color, font } = tokens;

/**
 * Header account menu (D116 surface — partial).
 *
 * Lists connected mailbox accounts, lets the user pick the active one,
 * manage a mailbox's connection/data, connect another Google account,
 * or sign out.
 *
 * D245 moves disconnect out of the cramped menu row and into an accessible
 * dialog with two explicit outcomes: keep the indexed history, or queue its
 * permanent deletion. The dialog's affected/retained lists come from the
 * shared Gmail-data registry.
 *
 * "Connect another" is a hard navigation to the OAuth start endpoint;
 * the BE clears the active-mailbox cookie path and the consent flow
 * appends the new account on success.
 */
export function AccountMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [managedMailboxId, setManagedMailboxId] = useState<string | null>(null);
  const [dataControlsError, setDataControlsError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const setActive = useSetActiveMailbox();
  const disconnect = useDisconnectMailbox();
  const deleteIndexedData = useDeleteMailboxIndexedData();
  const logout = useLogout();
  // D19/D81 inbox limit — gates ADDING (or reactivating) a Gmail
  // account; existing connections keep working even over-limit. The BE
  // mirror is InboxLimitGuard on connect-mailbox/start (402).
  const { tier, inboxLimit, connectedInboxes, atInboxLimit } = useTier();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // One emit per menu-open while at the limit (D159 — the funnel
  // counts appearances of the upgrade affordance, not re-renders).
  useEffect(() => {
    if (open && atInboxLimit) {
      void track('upgrade_prompt_shown', { reason: 'inbox_limit', source: 'account_menu' });
    }
  }, [open, atInboxLimit]);

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
  const managedMailbox = me.mailboxes.find((mailbox) => mailbox.id === managedMailboxId) ?? null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger max-width is class-driven so it can narrow below the
          shell's 900px sm breakpoint — on a phone the topbar row would
          otherwise push this switcher's right edge off-screen (untappable).
          CSS-driven (not a JS hook) so there is no post-hydration flash. */}
      <style>{`
        .dm-account-trigger { max-width: 220px; }
        @media (max-width: 900px) {
          .dm-account-trigger { max-width: 44vw; }
        }
      `}</style>
      <button
        type="button"
        className="dm-account-trigger"
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
            const indexedDataState = resolveIndexedDataState(m);
            const reconnectBlocked = isMailboxDataDeletionInFlight(indexedDataState);
            const lifecycleLabel = mailboxDataLifecycleLabel(indexedDataState);
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
                    {isDisconnected && lifecycleLabel && (
                      <span
                        style={{
                          fontSize: 10,
                          color:
                            indexedDataState === 'deletion_delayed' ? color.danger : color.fgMuted,
                        }}
                      >
                        {lifecycleLabel}
                      </span>
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
                      onClick={() => {
                        setManagedMailboxId(m.id);
                        setDataControlsError(null);
                        setOpen(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: color.fgMuted,
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '2px 6px',
                      }}
                    >
                      Manage
                    </button>
                  ) : (
                    // Reconnect a disconnected account — same OAuth flow as
                    // "connect another"; Google's chooser lets the user pick
                    // this account, which `addMailbox` reactivates (D116).
                    // Reactivating counts toward the D19 inbox limit, so
                    // the affordance is disabled at the limit (the BE
                    // start route would 402 anyway).
                    <button
                      type="button"
                      disabled={atInboxLimit || reconnectBlocked}
                      onClick={atInboxLimit || reconnectBlocked ? undefined : connectAnother}
                      title={
                        reconnectBlocked
                          ? indexedDataState === 'deletion_delayed'
                            ? 'Indexed-data deletion is delayed and will retry. Reconnect becomes available after deletion completes.'
                            : 'Reconnect becomes available after indexed-data deletion completes.'
                          : atInboxLimit
                            ? `Your plan includes ${inboxLimit} connected ${inboxLimit === 1 ? 'inbox' : 'inboxes'} — upgrade to reconnect this one.`
                            : undefined
                      }
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: atInboxLimit || reconnectBlocked ? color.fgMuted : color.primary,
                        cursor: atInboxLimit || reconnectBlocked ? 'not-allowed' : 'pointer',
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 6px',
                      }}
                    >
                      Reconnect
                    </button>
                  )}
                  {isDisconnected && indexedDataState === 'retained' && (
                    <button
                      type="button"
                      onClick={() => {
                        setManagedMailboxId(m.id);
                        setDataControlsError(null);
                        setOpen(false);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: color.fgMuted,
                        cursor: 'pointer',
                        fontSize: 11,
                        padding: '2px 6px',
                      }}
                    >
                      Delete data
                    </button>
                  )}
                </div>
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
            {atInboxLimit ? (
              // D19/D81 inbox-limit gate — replaces the connect
              // affordance with the honest state + the upgrade path.
              // Existing accounts above keep working; only ADDING is
              // blocked (BE mirror: 402 INBOX_LIMIT_REACHED).
              <div
                data-testid="inbox-limit-gate"
                style={{
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  fontSize: 12,
                  color: color.fgMuted,
                }}
              >
                <span>
                  {connectedInboxes > inboxLimit
                    ? // Over-limit (e.g. after a downgrade) — existing
                      // connections keep working; only adding is blocked.
                      `${connectedInboxes} inboxes connected — your ${tierLabel(tier)} plan includes ${inboxLimit}.`
                    : `${connectedInboxes} of ${inboxLimit} ${inboxLimit === 1 ? 'inbox' : 'inboxes'} connected — your ${tierLabel(tier)} plan's limit.`}
                </span>
                <Link
                  href="/pricing"
                  onClick={() => setOpen(false)}
                  style={{
                    color: color.primary,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Upgrade to connect another →
                </Link>
              </div>
            ) : (
              <button type="button" onClick={connectAnother} style={menuItemStyle()}>
                + Connect another Gmail account
              </button>
            )}
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
      <MailboxDataControlsDialog
        mailbox={managedMailbox}
        onCancel={() => {
          setManagedMailboxId(null);
          setDataControlsError(null);
        }}
        onDisconnect={() => {
          if (!managedMailbox) return;
          setDataControlsError(null);
          disconnect.mutate(managedMailbox.id, {
            onSuccess: () => {
              setManagedMailboxId(null);
              toast(
                `Disconnected ${managedMailbox.email}. Indexed history was kept; Gmail is unchanged.`,
                'success',
              );
            },
            onError: () => {
              setDataControlsError(
                `Could not disconnect ${managedMailbox.email}. Nothing was deleted; try again.`,
              );
            },
          });
        }}
        onDeleteIndexedData={(confirmPhrase) => {
          if (!managedMailbox) return;
          setDataControlsError(null);
          deleteIndexedData.mutate(
            { mailboxId: managedMailbox.id, confirmPhrase },
            {
              onSuccess: () => {
                setManagedMailboxId(null);
                toast(
                  `Disconnected ${managedMailbox.email}. Indexed data deletion started; Gmail is unchanged.`,
                  'success',
                );
              },
              onError: () => {
                setDataControlsError(
                  `Could not start indexed-data deletion for ${managedMailbox.email}. Nothing was deleted; try again.`,
                );
              },
            },
          );
        }}
        isDisconnecting={disconnect.isPending}
        isDeleting={deleteIndexedData.isPending}
        error={dataControlsError}
      />
    </div>
  );
}

/** Rolling-deploy fallback for cached `/auth/me` payloads without D245 fields. */
function resolveIndexedDataState(mailbox: MeMailbox) {
  return mailbox.indexedDataState ?? (mailbox.status === 'active' ? 'indexed' : 'retained');
}

function isMailboxDataDeletionInFlight(state: ReturnType<typeof resolveIndexedDataState>): boolean {
  return state === 'deletion_pending' || state === 'deleting' || state === 'deletion_delayed';
}

export function mailboxDataLifecycleLabel(
  state: ReturnType<typeof resolveIndexedDataState>,
): string | null {
  switch (state) {
    case 'deletion_pending':
      return 'deletion queued';
    case 'deleting':
      return 'deleting data…';
    case 'deletion_delayed':
      return 'deletion delayed';
    case 'deleted':
      return 'data deleted';
    case 'retained':
      return 'disconnected · data kept';
    default:
      return null;
  }
}

/** Display name for the tier in the inbox-limit gate copy. */
function tierLabel(tier: string): string {
  return tier === 'free' ? 'Free' : tier.charAt(0).toUpperCase() + tier.slice(1);
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
