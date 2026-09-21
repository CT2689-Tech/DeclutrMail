'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { tokens, toast } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { useLogout } from '@/features/auth/api/use-logout';
import { useTier } from '@/features/auth/api/use-tier';
import { useMailboxesHealth } from '@/features/settings/api/use-mailbox-health';
import { track } from '@/lib/posthog';
import { startMailboxConnect, startMailboxReactivation } from './connect-mailbox-url';
import { useDeleteMailboxIndexedData } from './api/use-delete-mailbox-indexed-data';
import { useDisconnectMailbox } from './api/use-disconnect-mailbox';
import { useSetActiveMailbox } from './api/use-set-active-mailbox';
import { MailboxDataControlsDialog } from './mailbox-data-controls-dialog';

const { color, font, motion, radius, shadow, text } = tokens;

/**
 * Header account menu (D116 surface — partial).
 *
 * Lists connected mailbox accounts, lets the user pick the active one,
 * manage a mailbox's connection/data, connect another Google account,
 * open Settings or Billing (account chores — they left the sidebar so
 * the nav is only the daily surfaces), or sign out.
 *
 * Manage opens the D245 outcome dialog: disconnect and retain indexed
 * history, or disconnect and permanently delete that mailbox's indexed
 * data. Both outcomes leave Gmail itself unchanged.
 *
 * "Connect another" uses the normal OAuth start. Disconnected-account
 * reactivation and active grant recovery each bind OAuth to the exact
 * mailbox, but remain separate flows because only reactivation can
 * consume an inbox slot.
 */
export function AccountMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const [managedMailboxId, setManagedMailboxId] = useState<string | null>(null);
  const [dataControlsError, setDataControlsError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const setActive = useSetActiveMailbox();
  const disconnect = useDisconnectMailbox();
  const deleteIndexedData = useDeleteMailboxIndexedData();
  const logout = useLogout();
  // D19/D81 inbox limit — gates ADDING (or reactivating) a Gmail
  // account; existing connections keep working even over-limit. The BE
  // mirror is InboxLimitGuard on connect-mailbox/start (402).
  const { tier, inboxLimit, connectedInboxes, atInboxLimit } = useTier();
  // Keep the closed disclosure cheap. Opening enables the mailbox-keyed
  // health reads: the selected mailbox dedupes with banner/Sync-now, while
  // each other active row gets one low-frequency poll only while visible.
  const healthById = useMailboxesHealth(me.mailboxes, { enabled: open });

  useEffect(() => {
    if (!open) return;
    // Nonmodal dialog disclosure: move focus into the panel, then let
    // ordinary Tab order traverse selectors, recovery, and account actions.
    panelRef.current?.focus();
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  // One emit per menu-open while at the limit (D159 — the funnel
  // counts appearances of the upgrade affordance, not re-renders).
  useEffect(() => {
    if (open && atInboxLimit) {
      void track('upgrade_prompt_shown', { reason: 'inbox_limit', source: 'account_menu' });
    }
  }, [open, atInboxLimit]);

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
        /* Small phones: the avatar alone. The top bar has no room for the
           address at 320px, and the menu it opens states it. Clipped, not
           display:none, so the address stays the button's accessible name. */
        @media (max-width: 480px) {
          .dm-account-label {
            position: absolute;
            width: 1px;
            height: 1px;
            margin: -1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
          }
        }
      `}</style>
      <button
        ref={triggerRef}
        type="button"
        className="dm-account-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="dm-account-menu"
        title={activeLabel}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px 0 4px',
          height: 32,
          background: 'transparent',
          border: 'none',
          borderRadius: radius.pill,
          color: color.fgSoft,
          cursor: 'pointer',
          fontFamily: font.sans,
          fontSize: text.sm,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            flexShrink: 0,
            borderRadius: radius.pill,
            background: color.primary,
            color: color.fgInverse,
            display: 'inline-grid',
            placeItems: 'center',
            fontSize: text.xs,
            fontWeight: 600,
          }}
        >
          {activeLabel.slice(0, 1).toUpperCase()}
        </span>
        <span
          className="dm-account-label"
          style={{ fontFamily: font.mono, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {activeLabel}
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="dm-account-menu"
          role="dialog"
          aria-label="Gmail accounts"
          tabIndex={-1}
          style={{
            position: 'absolute',
            top: 40,
            right: 0,
            width: 300,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100vh - 72px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            boxSizing: 'border-box',
            background: color.card,
            borderRadius: radius.lg,
            boxShadow: shadow.pop,
            padding: 8,
            fontFamily: font.sans,
            fontSize: text.md,
            zIndex: 90,
          }}
        >
          {/* -04: nothing else in this menu says switching rescopes every
              screen, not just this pill — a first-timer switching by
              accident had no way to know why their sender list changed. */}
          <div style={{ padding: '4px 8px 8px', fontSize: text.xs, color: color.fgMuted }}>
            Everything you see is scoped to the active account.
          </div>
          {me.mailboxes.length === 0 && (
            <div style={{ padding: '6px 8px', color: color.fgMuted }}>No mailboxes connected.</div>
          )}
          {me.mailboxes.map((m) => {
            const isSelected = m.id === activeMailbox?.id;
            const isDisconnected = m.status === 'disconnected';
            const needsReconnect = !isDisconnected && healthById[m.id]?.needsReconnect === true;
            const indexedDataState = resolveIndexedDataState(m);
            const reconnectBlocked = isMailboxDataDeletionInFlight(indexedDataState);
            const lifecycleLabel = mailboxDataLifecycleLabel(indexedDataState);
            return (
              <div
                key={m.id}
                data-testid={`account-mailbox-${m.id}`}
                style={{ borderTop: `1px solid ${color.line}` }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                    padding: '6px 8px',
                    // Highlight the active mailbox so it reads as the
                    // current selection (not just a ✓) — the switch
                    // button is inert on the active row, which otherwise
                    // looked like "can't select it".
                    background: isSelected ? color.primarySoft : 'transparent',
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${isSelected ? 'Active mailbox' : 'Switch to mailbox'} ${m.email}${needsReconnect ? ', needs reconnect' : ''}`}
                    disabled={isDisconnected || setActive.isPending}
                    onClick={() => {
                      if (isSelected) return;
                      // A revoked mailbox remains selectable: cached history
                      // and recovery context stay useful even before Gmail is
                      // re-authorized. Only Gmail-dependent actions pause.
                      setActive.mutate(m.id, {
                        onError: () => {
                          toast('Could not switch Gmail accounts. Please try again.', 'warn');
                        },
                        onSuccess: () => {
                          setOpen(false);
                          triggerRef.current?.focus();
                        },
                      });
                    }}
                    style={{
                      flex: '1 1 180px',
                      minWidth: 150,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: isDisconnected ? color.fgMuted : color.fg,
                      cursor: isDisconnected ? 'not-allowed' : 'pointer',
                      fontFamily: font.mono,
                      fontSize: text.sm,
                      textAlign: 'left',
                    }}
                  >
                    <span aria-hidden style={{ width: 14, color: color.primary }}>
                      {isSelected ? '✓' : ' '}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'block',
                        overflow: 'hidden',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                    >
                      <span
                        title={m.email}
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.email}
                      </span>
                      {needsReconnect && (
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 6,
                            marginTop: 2,
                          }}
                        >
                          {isSelected && <MenuStatus tone="primary">Active</MenuStatus>}
                          <MenuStatus tone="danger">Needs reconnect</MenuStatus>
                        </span>
                      )}
                    </span>
                    {isSelected && !isDisconnected && !needsReconnect && (
                      <MenuStatus tone="primary">Active</MenuStatus>
                    )}
                    {isDisconnected && (
                      <MenuStatus
                        tone={indexedDataState === 'deletion_delayed' ? 'danger' : 'muted'}
                      >
                        {lifecycleLabel ?? 'Disconnected'}
                      </MenuStatus>
                    )}
                    {/* Per-mailbox initial-sync state (D116). `ready`/null
                        render nothing — they're the steady state. A revoked
                        grant suppresses this tag because "scan failed" is a
                        less useful duplicate of the actual recovery state. */}
                    {!isDisconnected &&
                      !needsReconnect &&
                      m.readiness &&
                      m.readiness !== 'ready' && (
                        <MenuStatus tone={m.readiness === 'failed' ? 'danger' : 'muted'}>
                          {m.readiness === 'failed' ? 'Scan failed' : 'Syncing…'}
                        </MenuStatus>
                      )}
                    {/* QA-sync-20260831-04: `readiness` stays `ready` for a
                        failed INCREMENTAL sync by the worker's own design
                        (only an initial-sync failure ever flips it), so the
                        branch above never fires for this case — this
                        mailbox previously carried no tag at all. */}
                    {!isDisconnected &&
                      !needsReconnect &&
                      m.readiness === 'ready' &&
                      healthById[m.id]?.hasSyncError && (
                        <MenuStatus tone="danger">Not syncing</MenuStatus>
                      )}
                  </button>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      gap: 2,
                      marginLeft: 'auto',
                      flexWrap: 'wrap',
                    }}
                  >
                    {needsReconnect && (
                      <button
                        type="button"
                        aria-label={`Reconnect ${m.email}`}
                        onClick={() => startMailboxConnect(m.id)}
                        style={mailboxActionStyle('primary')}
                      >
                        Reconnect
                      </button>
                    )}
                    {!isDisconnected ? (
                      <button
                        type="button"
                        aria-label={`Manage connection and data for ${m.email}`}
                        onClick={() => {
                          setManagedMailboxId(m.id);
                          setDataControlsError(null);
                          setOpen(false);
                        }}
                        style={mailboxActionStyle('muted')}
                      >
                        Manage
                      </button>
                    ) : (
                      // Disconnected reactivation can consume a slot, so it
                      // keeps the plan-limit gate while binding OAuth to the
                      // exact disconnected mailbox the user selected.
                      <button
                        type="button"
                        disabled={atInboxLimit || reconnectBlocked}
                        aria-label={`Reconnect ${m.email}`}
                        aria-describedby={
                          atInboxLimit ? 'account-menu-inbox-limit-gate' : undefined
                        }
                        title={
                          reconnectBlocked
                            ? "You can reconnect once we've finished erasing what we stored."
                            : undefined
                        }
                        onClick={() => startMailboxReactivation(m.id)}
                        style={mailboxActionStyle(
                          atInboxLimit || reconnectBlocked ? 'disabled' : 'primary',
                        )}
                      >
                        Reconnect
                      </button>
                    )}
                    {isDisconnected && indexedDataState === 'retained' && (
                      <button
                        type="button"
                        aria-label={`Manage retained data for ${m.email}`}
                        onClick={() => {
                          setManagedMailboxId(m.id);
                          setDataControlsError(null);
                          setOpen(false);
                        }}
                        style={mailboxActionStyle('muted')}
                      >
                        Delete data
                      </button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
          <div
            style={{
              borderTop: `1px solid ${color.line}`,
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
                id="account-menu-inbox-limit-gate"
                data-testid="inbox-limit-gate"
                style={{
                  padding: '6px 8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  fontSize: text.sm,
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
                  href="/billing"
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
              <button
                type="button"
                className="dm-nav-row"
                onClick={() => startMailboxConnect()}
                style={menuItemStyle()}
              >
                Add Gmail account
              </button>
            )}
            <Link
              href="/settings"
              className="dm-nav-row"
              onClick={() => setOpen(false)}
              style={menuItemStyle()}
            >
              Settings
            </Link>
            <Link
              href="/billing"
              className="dm-nav-row"
              onClick={() => setOpen(false)}
              style={menuItemStyle()}
            >
              Billing
            </Link>
            <button
              type="button"
              className="dm-nav-row"
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
                `Disconnected ${managedMailbox.email}. DeclutrMail history was kept; Gmail is unchanged.`,
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
                  `Disconnected ${managedMailbox.email}. Saved-data deletion started; Gmail is unchanged.`,
                  'success',
                );
              },
              onError: () => {
                setDataControlsError(
                  `Could not start deleting saved data for ${managedMailbox.email}. Nothing was deleted; try again.`,
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
      return 'Deletion scheduled';
    case 'deleting':
      return 'Deleting data…';
    case 'deletion_delayed':
      return 'Deletion delayed';
    case 'deleted':
      return 'Data deleted';
    case 'retained':
      return 'Disconnected · history kept';
    default:
      return null;
  }
}

function MenuStatus({
  tone,
  children,
}: {
  tone: 'primary' | 'muted' | 'danger';
  children: string;
}) {
  const fg = tone === 'primary' ? color.primary : tone === 'danger' ? color.danger : color.fgMuted;
  return (
    <span
      style={{
        flexShrink: 0,
        fontFamily: font.sans,
        fontSize: text.xs,
        fontWeight: 600,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

function mailboxActionStyle(tone: 'primary' | 'muted' | 'disabled') {
  const disabled = tone === 'disabled';
  return {
    background: 'transparent',
    border: 'none',
    color: tone === 'primary' ? color.primary : color.fgMuted,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.65 : 1,
    fontFamily: font.sans,
    fontSize: text.sm,
    fontWeight: tone === 'primary' ? 600 : 400,
    padding: '4px 6px',
    whiteSpace: 'nowrap' as const,
  };
}

/** Display name for the tier in the inbox-limit gate copy. */
function tierLabel(tier: string): string {
  return tier === 'free' ? 'Free' : tier.charAt(0).toUpperCase() + tier.slice(1);
}

// No `background` here: `.dm-nav-row` (tokens.css) owns the resting and
// hover fills, and an inline value would outrank its hover.
function menuItemStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    boxSizing: 'border-box' as const,
    border: 'none',
    color: color.fg,
    cursor: 'pointer',
    fontFamily: font.sans,
    fontSize: text.md,
    textAlign: 'left' as const,
    textDecoration: 'none',
    // No inline min-height — it would outrank the class's 44px on touch.
    padding: '8px',
    borderRadius: radius.sm,
    transition: `background ${motion.fast} ${motion.ease}`,
  };
}
