'use client';

import Link from 'next/link';
import { useRetryInitialSync } from '@/features/sync/api/use-retry-initial-sync';
import { useNow } from '@/lib/use-now';
import { Button, Pill, tokens } from '@declutrmail/shared';
import type { MeMailbox } from '@/features/auth/api/use-me';
import type { MailboxHealth } from '../api/use-mailbox-health';
import { SettingsGroup } from '../settings-list';

const { color, font, text, motion, radius } = tokens;
const MAILBOX_LIMIT_EXPLANATION_ID = 'mailboxes-inbox-limit-explanation';

/**
 * Settings → Mailboxes (D114 "Inboxes" section + D115 health, scoped).
 *
 * Per-mailbox connection health: status (Active / Needs reconnect /
 * Disconnected), initial-sync readiness, and a humanized last-synced
 * stamp from the sync-status facade (`useMailboxesHealth` in the
 * container). An active mailbox whose Gmail grant expired uses a
 * target-bound reconnect; a disconnected mailbox uses a distinct,
 * target-bound reactivation flow because it can change the connected-inbox
 * count without allowing Google account selection to change the target.
 * Switch and disconnect stay in the account menu (reuse, don't rebuild).
 *
 * Inbox limit (D19 tiers): adding or reactivating disables at the tier's
 * `inboxLimit`. Re-authorizing an already-active mailbox remains enabled
 * because it is already counted and does not consume another slot.
 */
export function MailboxesCard({
  mailboxes,
  activeMailboxId,
  inboxLimit,
  healthById,
  highlightMailboxId = null,
  onConnect,
  onReactivate,
}: {
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
  /** The tier's connected-inbox allowance, or null while tier unknown. */
  inboxLimit: number | null;
  /** Per-mailbox sync health; entries absent while their query loads. */
  healthById: Record<string, MailboxHealth | undefined>;
  /** Brief visual acknowledgement after a target-bound reconnect return. */
  highlightMailboxId?: string | null;
  /** OAuth start; an id binds reauthorization to that active mailbox. */
  onConnect: (reconnectMailboxId?: string) => void;
  /** OAuth start bound to the disconnected mailbox being reactivated. */
  onReactivate: (mailboxId: string) => void;
}) {
  const now = useNow();
  const activeCount = mailboxes.filter((m) => m.status === 'active').length;
  const atLimit = inboxLimit !== null && activeCount >= inboxLimit;

  return (
    <SettingsGroup
      id="mailboxes"
      title="Gmail accounts"
      focusable
      footer={
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Button tone="default" onClick={() => onConnect()} disabled={atLimit}>
            {mailboxes.length === 0 ? 'Connect Gmail' : 'Add Gmail account'}
          </Button>
          {atLimit && (
            <span
              id={MAILBOX_LIMIT_EXPLANATION_ID}
              style={{ fontSize: text.sm, color: color.fgMuted }}
            >
              Your plan includes {inboxLimit} connected {inboxLimit === 1 ? 'inbox' : 'inboxes'} —{' '}
              <Link href="/billing" style={{ color: color.primary }}>
                upgrade for more
              </Link>
              .
            </span>
          )}
        </div>
      }
    >
      {mailboxes.length === 0 ? (
        <p
          className="dm-settings-row"
          style={{
            fontSize: text.md,
            color: color.fgMuted,
            margin: 0,
            padding: '17px 16px',
          }}
        >
          No mailboxes connected yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {mailboxes.map((m) => {
            const isSelected = m.id === activeMailboxId && m.status === 'active';
            const health = healthById[m.id];
            const needsReconnect = m.status === 'active' && health?.needsReconnect === true;
            const showReconnect = m.status === 'disconnected' || needsReconnect;
            const indexedDataState =
              m.indexedDataState ?? (m.status === 'active' ? 'indexed' : 'retained');
            const deletionInFlight =
              indexedDataState === 'deletion_pending' ||
              indexedDataState === 'deleting' ||
              indexedDataState === 'deletion_delayed';
            // A disabled control must say why in VISIBLE text — a `title`
            // tooltip reaches neither touch nor keyboard nor a screen reader.
            // The tier-limit reason renders once at the card footer instead,
            // so only the per-row deletion reason is carried here.
            const reconnectBlockedReason = deletionInFlight
              ? indexedDataState === 'deletion_delayed'
                ? 'Data deletion is delayed and will retry. Reconnect becomes available after deletion completes.'
                : "You can reconnect once we've finished erasing what we stored."
              : undefined;
            const reconnectBlockedReasonId = `mailbox-${m.id}-reconnect-blocked`;
            const reconnectBlocked = deletionInFlight || (atLimit && !needsReconnect);
            const reconnectHighlighted = m.id === highlightMailboxId;
            return (
              <li
                key={m.id}
                id={`mailbox-${m.id}`}
                tabIndex={-1}
                data-reconnect-highlighted={reconnectHighlighted ? 'true' : undefined}
                className="dm-settings-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  minHeight: 64,
                  padding: '10px 16px',
                  boxSizing: 'border-box',
                  scrollMarginTop: 24,
                  background: reconnectHighlighted ? color.primarySoft : 'transparent',
                  outline: reconnectHighlighted ? `2px solid ${color.primary}` : 'none',
                  outlineOffset: -2,
                  transition: `background-color ${motion.base} ${motion.ease}, outline-color ${motion.base} ${motion.ease}`,
                }}
              >
                <MailboxAvatar
                  email={m.email}
                  tone={
                    m.status === 'disconnected' ? 'muted' : needsReconnect ? 'danger' : 'primary'
                  }
                />
                <span style={{ flex: '1 1 200px', minWidth: 140 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: font.sans,
                      fontSize: text.md,
                      fontWeight: 500,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: m.status === 'disconnected' ? color.fgMuted : color.fg,
                    }}
                  >
                    {m.email}
                  </span>
                  {m.status === 'active' && health?.lastSyncedAt && now !== null && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: text.sm,
                        color: color.fgMuted,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                      title={new Date(health.lastSyncedAt).toLocaleString('en-US')}
                    >
                      Synced {relAge(health.lastSyncedAt, now)}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                    gap: 8,
                    marginLeft: 'auto',
                    minWidth: 0,
                  }}
                >
                  {isSelected && <StatusTag tone="primary">Active</StatusTag>}
                  {m.status === 'disconnected' ? (
                    <StatusTag tone={indexedDataState === 'deletion_delayed' ? 'danger' : 'muted'}>
                      {mailboxDataStatusLabel(indexedDataState)}
                    </StatusTag>
                  ) : needsReconnect ? (
                    <StatusTag tone="danger">Needs reconnect</StatusTag>
                  ) : m.readiness === 'queued' || m.readiness === 'syncing' ? (
                    <StatusTag tone="muted">Syncing…</StatusTag>
                  ) : m.readiness === 'failed' ? (
                    <>
                      {/* QA-sync-20260831-09: "scan" is this product's
                            sanctioned term for this event (the onboarding
                            gate, the retry endpoint's own semantics, and
                            check-microcopy.sh's ban list all use it) —
                            "sync" was the odd one out on this card. */}
                      <StatusTag tone="danger">Scan failed</StatusTag>
                      {/* The sibling #418 missed: the onboarding gate got a
                            real retry while this card kept a dead-end tag
                            (fix-the-class, D158 triage). Same endpoint, same
                            explicit mailbox scoping — the row's id, never
                            "whatever is active". */}
                      <RetrySyncButton mailboxId={m.id} />
                    </>
                  ) : m.readiness === 'ready' && health?.hasSyncError ? (
                    // QA-sync-20260831-04: readiness stays `ready` for a
                    // failed INCREMENTAL sync by the worker's own design
                    // (only an initial-sync failure ever flips it) — a
                    // persistently-broken mailbox otherwise read as plain
                    // "Ready" here, worse than no tag at all.
                    <StatusTag tone="danger">Not syncing</StatusTag>
                  ) : m.readiness === 'ready' ? (
                    <StatusTag tone="muted">Ready</StatusTag>
                  ) : (
                    // readiness === null: no sync row exists yet (D116), so
                    // the first scan has not been recorded. Never fold this
                    // into "Ready" — that claims a scan we cannot see.
                    <StatusTag tone="muted">Not synced yet</StatusTag>
                  )}
                  {showReconnect && (
                    <>
                      {reconnectBlockedReason && (
                        <span
                          id={reconnectBlockedReasonId}
                          style={{
                            fontSize: text.sm,
                            color: color.fgMuted,
                            flex: '1 1 200px',
                            minWidth: 0,
                            textAlign: 'right',
                          }}
                        >
                          {reconnectBlockedReason}
                        </span>
                      )}
                      <ReconnectButton
                        disabled={reconnectBlocked}
                        describedBy={
                          reconnectBlockedReason
                            ? reconnectBlockedReasonId
                            : atLimit && !needsReconnect
                              ? MAILBOX_LIMIT_EXPLANATION_ID
                              : undefined
                        }
                        email={m.email}
                        label={
                          indexedDataState === 'deleted' ? 'Reconnect · start fresh' : 'Reconnect'
                        }
                        onClick={() => (needsReconnect ? onConnect(m.id) : onReactivate(m.id))}
                      />
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsGroup>
  );
}

function mailboxDataStatusLabel(state: NonNullable<MeMailbox['indexedDataState']>): string {
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
      return 'Disconnected';
  }
}

function ReconnectButton({
  disabled,
  describedBy,
  email,
  label,
  onClick,
}: {
  disabled: boolean;
  describedBy: string | undefined;
  email: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      tone="default"
      size="sm"
      disabled={disabled}
      ariaLabel={`Reconnect ${email}`}
      {...(describedBy ? { ariaDescribedBy: describedBy } : {})}
      onClick={onClick}
      style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {label}
    </Button>
  );
}

/**
 * Row-scoped retry for a failed INITIAL sync. Each failed row owns its
 * own mutation instance so two failed mailboxes cannot share pending
 * state. `useRetryInitialSync` names the row's mailbox explicitly via
 * `X-Active-Mailbox-Id` and invalidates the `SYNC_STATUS_KEY` prefix on
 * success — which is exactly the key family `useMailboxesHealth` reads,
 * so the tag flips to "Syncing…" from server truth, not optimism.
 */
function RetrySyncButton({ mailboxId }: { mailboxId: string }) {
  const retry = useRetryInitialSync(mailboxId);
  return (
    <Button tone="default" size="sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
      {retry.isPending ? 'Starting…' : 'Scan again'}
    </Button>
  );
}

/** ISO → compact relative age (same shape as SyncNowButton's label). */
function relAge(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Status as a small pill; colour only where it is the Active state or a fault. */
function StatusTag({ tone, children }: { tone: 'primary' | 'muted' | 'danger'; children: string }) {
  return (
    <Pill
      tone={tone === 'primary' ? 'primary' : tone === 'danger' ? 'red' : 'default'}
      style={{ flexShrink: 0, fontSize: text.xs }}
    >
      {children}
    </Pill>
  );
}

/** The account's initial in a 40px circle — the row's anchor, not a brand mark. */
function MailboxAvatar({ email, tone }: { email: string; tone: 'primary' | 'muted' | 'danger' }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.pill,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          tone === 'primary' ? color.primarySoft : tone === 'danger' ? color.redBg : color.fill,
        color: tone === 'primary' ? color.primary : tone === 'danger' ? color.red : color.fgMuted,
        fontFamily: font.sans,
        fontSize: text.md,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {email.trim()[0] ?? '?'}
    </span>
  );
}
