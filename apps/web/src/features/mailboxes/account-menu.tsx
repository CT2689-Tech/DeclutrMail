'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useUpgradeReturnTo } from '@/features/billing/use-upgrade-return-to';
import { billingIntentPath } from '@/features/billing/billing-intent';
import {
  planName,
  plusConnectCta,
  plusInboxLimitTitle,
  proWaitlistCta,
} from '@declutrmail/shared/entitlements';
import { tokens, toast } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import type { MeMailbox } from '@/features/auth/api/use-me';
import { useLogout } from '@/features/auth/api/use-logout';
import { useTier } from '@/features/auth/api/use-tier';
import { useMailboxesHealth } from '@/features/settings/api/use-mailbox-health';
import { reportPassSecondAccountGate } from '@/lib/entitlements/upgrade-gate';
import { track } from '@/lib/posthog';
import { startMailboxConnect, startMailboxReactivation } from './connect-mailbox-url';
import { useDeleteMailboxIndexedData } from './api/use-delete-mailbox-indexed-data';
import { useDisconnectMailbox } from './api/use-disconnect-mailbox';
import { useSetActiveMailbox } from './api/use-set-active-mailbox';
import { loadMailboxDataControls } from './load-mailbox-data-controls';
import styles from './account-menu.module.css';

// The dialog lists what disconnect and deletion remove from the whole Gmail
// data inventory. Loaded on demand: imported here, that registry rode every
// signed-in route's first load for a dialog few people open.
const MailboxDataControlsDialog = dynamic(
  () => loadMailboxDataControls().then((m) => m.MailboxDataControlsDialog),
  { ssr: false },
);

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
  const from = useUpgradeReturnTo();
  const [open, setOpen] = useState(false);

  // Fetch the data dialog while the menu is open, before its button is
  // pressed: on a slow connection a disconnect/delete control that showed
  // nothing for a moment would read as a dead click. A failed prefetch
  // changes nothing — the dialog's own load runs again on the click.
  useEffect(() => {
    if (open) loadMailboxDataControls().catch(() => undefined);
  }, [open]);
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
  const { tier, inboxLimit, inboxLimitReason, connectedInboxes, atInboxLimit, pricingV2 } =
    useTier();
  const passInboxLimit = inboxLimitReason === 'pass';
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
      // Own this press even if React removes the dialog before page listeners run.
      e.preventDefault();
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
      void track('upgrade_prompt_shown', {
        reason: passInboxLimit ? 'pass_second_account' : 'inbox_limit',
        source: 'account_menu',
      });
    }
  }, [open, atInboxLimit, passInboxLimit]);

  const activeMailbox =
    me.mailboxes.find((m) => m.id === me.activeMailboxId) ??
    me.mailboxes.find((m) => m.status === 'active');
  const activeLabel = activeMailbox?.email ?? me.user.email;
  const managedMailbox = me.mailboxes.find((mailbox) => mailbox.id === managedMailboxId) ?? null;
  const openDataControls = (mailboxId: string) => {
    // The menu entry unmounts. Let the modal remember the persistent
    // account trigger as its return target before it takes focus.
    triggerRef.current?.focus();
    setManagedMailboxId(mailboxId);
    setDataControlsError(null);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="dm-account-menu"
        title={activeLabel}
        style={{
          position: 'relative',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 9,
          padding: '4px 8px 4px 4px',
          border: 'none',
          borderRadius: radius.pill,
          color: color.fgSoft,
          cursor: 'pointer',
          fontFamily: font.sans,
          transition: `background ${motion.fast} ${motion.ease}`,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: radius.pill,
            background: color.primary,
            color: color.fgInverse,
            boxShadow: shadow.button,
            display: 'inline-grid',
            placeItems: 'center',
            fontSize: text.base,
            fontWeight: 600,
          }}
        >
          {activeLabel.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.triggerLabel}>{activeLabel}</span>
        <span aria-hidden="true" className={styles.caret}>
          ⌄
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          id="dm-account-menu"
          role="dialog"
          aria-label="Gmail accounts"
          tabIndex={-1}
          className={styles.panel}
          style={{
            position: 'absolute',
            top: 44,
            right: 0,
            transformOrigin: 'top right',
            width: 338,
            maxWidth: 'calc(100vw - 24px)',
            maxHeight: 'calc(100dvh - 100px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain',
            boxSizing: 'border-box',
            background: color.card,
            borderRadius: radius.lg,
            boxShadow: shadow.pop,
            padding: 12,
            fontFamily: font.sans,
            fontSize: text.md,
            zIndex: 90,
          }}
        >
          <div className={styles.menuHeader}>
            <h2>Gmail accounts</h2>
            <button
              type="button"
              className={styles.closeButton}
              aria-label="Close account menu"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </div>
          <p className={styles.scope}>Switch the mailbox shown across the app.</p>
          {me.mailboxes.length === 0 && (
            <div style={{ padding: '6px 12px', color: color.fgMuted }}>
              No Gmail account connected.
            </div>
          )}
          {me.mailboxes.map((m) => {
            const addressBreak = m.email.lastIndexOf('@');
            const isSelected = m.id === activeMailbox?.id;
            const isDisconnected = m.status === 'disconnected';
            const needsReconnect = !isDisconnected && healthById[m.id]?.needsReconnect === true;
            const indexedDataState = resolveIndexedDataState(m);
            const reconnectBlocked = isMailboxDataDeletionInFlight(indexedDataState);
            const lifecycleLabel = mailboxDataLifecycleLabel(indexedDataState);
            return (
              <div key={m.id} data-testid={`account-mailbox-${m.id}`} style={{ marginTop: 2 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                    minHeight: 44,
                    boxSizing: 'border-box',
                    padding: '4px 8px',
                    borderRadius: radius.md,
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
                    aria-label={`${isSelected ? 'Selected Gmail account' : 'Switch to this Gmail account'} ${m.email}${needsReconnect ? ', needs reconnect' : ''}`}
                    disabled={isDisconnected || setActive.isPending}
                    onClick={() => {
                      if (isSelected) return;
                      // A revoked mailbox remains selectable: cached history
                      // and recovery context stay useful even before Gmail is
                      // re-authorized. Only Gmail-dependent actions pause.
                      setActive.mutate(m.id, {
                        onError: () => {
                          toast('Couldn’t switch Gmail accounts. Try again.', 'warn');
                        },
                        onSuccess: () => {
                          setOpen(false);
                          triggerRef.current?.focus();
                        },
                      });
                    }}
                    style={{
                      flex: '1 1 0',
                      minWidth: 0,
                      flexWrap: 'wrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '4px 4px',
                      background: 'transparent',
                      border: 'none',
                      color: isDisconnected ? color.fgMuted : color.fg,
                      cursor: isDisconnected ? 'not-allowed' : 'pointer',
                      fontFamily: font.sans,
                      fontSize: text.sm,
                      textAlign: 'left',
                      minHeight: 44,
                    }}
                  >
                    <span aria-hidden="true" className={styles.mailboxAvatar}>
                      {m.email.slice(0, 1).toUpperCase()}
                    </span>
                    <span
                      style={{
                        flex: '1 1 0',
                        minWidth: 0,
                        display: 'block',
                        fontWeight: isSelected ? 600 : 500,
                      }}
                    >
                      <span
                        title={m.email}
                        style={{
                          display: 'block',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {addressBreak > 0 ? (
                          <>
                            {m.email.slice(0, addressBreak)}
                            <wbr />
                            {m.email.slice(addressBreak)}
                          </>
                        ) : (
                          m.email
                        )}
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
                          <MenuStatus tone="danger">Needs reconnect</MenuStatus>
                        </span>
                      )}
                    </span>
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
                        <MenuStatus tone="danger">Not updating</MenuStatus>
                      )}
                    {isSelected && (
                      <span aria-hidden="true" className={styles.activeCheck}>
                        ✓
                      </span>
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
                        title={`Manage connection and data for ${m.email}`}
                        onClick={() => openDataControls(m.id)}
                        style={mailboxActionStyle('muted')}
                      >
                        <svg
                          aria-hidden="true"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <circle cx="5" cy="12" r="1.6" />
                          <circle cx="12" cy="12" r="1.6" />
                          <circle cx="19" cy="12" r="1.6" />
                        </svg>
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
                            ? 'You can reconnect once we’ve finished erasing what we stored.'
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
                        onClick={() => openDataControls(m.id)}
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
              marginTop: 8,
              paddingTop: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {atInboxLimit && passInboxLimit ? (
              <button
                type="button"
                className="dm-nav-row"
                onClick={() => {
                  setOpen(false);
                  reportPassSecondAccountGate({
                    limit: inboxLimit,
                    connected: connectedInboxes,
                    reason: 'pass',
                  });
                }}
                style={menuItemStyle()}
              >
                Add Gmail account
              </button>
            ) : atInboxLimit ? (
              // D19/D81 inbox-limit gate — replaces the connect
              // affordance with the honest state + the upgrade path.
              // Existing accounts above keep working; only ADDING is
              // blocked (BE mirror: 402 INBOX_LIMIT_REACHED).
              <div
                id="account-menu-inbox-limit-gate"
                data-testid="inbox-limit-gate"
                style={{
                  padding: '6px 12px',
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
                    : `${connectedInboxes} of ${inboxLimit} ${inboxLimit === 1 ? 'inbox' : 'inboxes'} connected — your ${tierLabel(tier)} plan’s limit.`}
                </span>
                {pricingV2 && tier === 'plus' ? (
                  <Link
                    href="/billing#change-plan"
                    onClick={() => setOpen(false)}
                    style={{
                      color: color.primary,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    {plusInboxLimitTitle()} {proWaitlistCta()}
                  </Link>
                ) : (
                  <Link
                    href={billingIntentPath({
                      plan: pricingV2 ? 'plus' : 'pro',
                      cycle: pricingV2 ? 'annual' : 'monthly',
                      ...(from ? { from } : {}),
                    })}
                    onClick={() => setOpen(false)}
                    style={{
                      color: color.primary,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    {pricingV2 ? plusConnectCta() : 'Upgrade to connect another →'}
                  </Link>
                )}
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
            <div className={styles.divider} />
            <Link
              href="/settings#mailboxes"
              className="dm-nav-row"
              onClick={() => setOpen(false)}
              style={menuItemStyle()}
            >
              Manage accounts
            </Link>
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
              Plan & billing
              <span aria-hidden="true" className={styles.plan}>
                {planName(tier)}
              </span>
            </Link>
            <div className={styles.divider} />
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
      {managedMailbox && (
        <MailboxDataControlsDialog
          mailbox={managedMailbox}
          returnFocusRef={triggerRef}
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
              // An error does not prove the disconnect failed: the server
              // can commit it before the response is lost. It is
              // idempotent, so another try confirms it either way.
              onError: () => {
                setDataControlsError(
                  `Could not confirm disconnecting ${managedMailbox.email}. Check the account status before trying again.`,
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
                // The deletion can be scheduled before the request fails
                // (the preference clear runs after it), so "nothing was
                // deleted" was unproven. A retry returns the scheduled
                // request if there is one.
                onError: () => {
                  setDataControlsError(
                    `Could not confirm saved-data deletion for ${managedMailbox.email}. Check the account status before trying again.`,
                  );
                },
              },
            );
          }}
          isDisconnecting={disconnect.isPending}
          isDeleting={deleteIndexedData.isPending}
          error={dataControlsError}
        />
      )}
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
  const fg =
    tone === 'primary' ? color.primary : tone === 'danger' ? color.dangerText : color.fgMuted;
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
    minHeight: 44,
    minWidth: 44,
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
    fontSize: text.sm,
    textAlign: 'left' as const,
    textDecoration: 'none',
    fontWeight: 500,
    height: 44,
    padding: '0 12px',
    borderRadius: radius.md,
    transition: `background ${motion.fast} ${motion.ease}`,
  };
}
