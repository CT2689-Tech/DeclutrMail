'use client';

import Link from 'next/link';
import { Button, Card, tokens } from '@declutrmail/shared';
import type { MeMailbox } from '@/features/auth/api/use-me';
import type { MailboxHealth } from '../api/use-mailbox-health';

const { color, font } = tokens;
const MAILBOX_LIMIT_EXPLANATION_ID = 'mailboxes-inbox-limit-explanation';

/**
 * Settings → Mailboxes (D114 "Inboxes" section + D115 health, scoped).
 *
 * Per-mailbox connection health: status (Active / Needs reconnect /
 * Disconnected), initial-sync readiness, and a humanized last-synced
 * stamp from the sync-status facade (`useMailboxesHealth` in the
 * container). An active mailbox whose Gmail grant expired uses a
 * target-bound reconnect; a disconnected mailbox still uses the normal
 * connect flow because reactivation changes the connected-inbox count.
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
  onConnect,
}: {
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
  /** The tier's connected-inbox allowance, or null while tier unknown. */
  inboxLimit: number | null;
  /** Per-mailbox sync health; entries absent while their query loads. */
  healthById: Record<string, MailboxHealth | undefined>;
  /** OAuth start; an id binds reauthorization to that active mailbox. */
  onConnect: (reconnectMailboxId?: string) => void;
}) {
  const activeCount = mailboxes.filter((m) => m.status === 'active').length;
  const atLimit = inboxLimit !== null && activeCount >= inboxLimit;

  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>Mailboxes</h3>
        <p style={mutedTextStyle}>
          Connected Gmail accounts and their connection health. Switch or disconnect from the
          account menu in the top bar.
        </p>

        {mailboxes.length === 0 ? (
          <p style={mutedTextStyle}>No mailboxes connected yet — connect one to start.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {mailboxes.map((m, i) => {
              const isSelected = m.id === activeMailboxId && m.status === 'active';
              const health = healthById[m.id];
              const needsReconnect = m.status === 'active' && health?.needsReconnect === true;
              const showReconnect = m.status === 'disconnected' || needsReconnect;
              const reconnectBlocked = atLimit && !needsReconnect;
              return (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10,
                    padding: '9px 0',
                    borderTop: i === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      flexShrink: 0,
                      background:
                        m.status === 'disconnected'
                          ? color.fgMuted
                          : needsReconnect
                            ? color.danger
                            : color.primary,
                    }}
                  />
                  <span style={{ flex: '1 1 220px', minWidth: 160 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13.5,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: m.status === 'disconnected' ? color.fgMuted : color.fg,
                      }}
                    >
                      {m.email}
                    </span>
                    {m.status === 'active' && health?.lastSyncedAt && (
                      <span
                        style={{ display: 'block', fontSize: 11, color: color.fgMuted }}
                        title={new Date(health.lastSyncedAt).toLocaleString()}
                      >
                        Synced {relAge(health.lastSyncedAt)}
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
                    {isSelected && (
                      <StatusTag tone="primary">{needsReconnect ? 'Selected' : 'Active'}</StatusTag>
                    )}
                    {m.status === 'disconnected' ? (
                      <StatusTag tone="muted">Disconnected</StatusTag>
                    ) : needsReconnect ? (
                      <StatusTag tone="danger">Needs reconnect</StatusTag>
                    ) : m.readiness === 'queued' || m.readiness === 'syncing' ? (
                      <StatusTag tone="muted">Syncing…</StatusTag>
                    ) : m.readiness === 'failed' ? (
                      <StatusTag tone="danger">Sync failed</StatusTag>
                    ) : (
                      <StatusTag tone="muted">Ready</StatusTag>
                    )}
                    {showReconnect && (
                      <ReconnectButton
                        disabled={reconnectBlocked}
                        describedBy={reconnectBlocked ? MAILBOX_LIMIT_EXPLANATION_ID : undefined}
                        email={m.email}
                        onClick={() => onConnect(needsReconnect ? m.id : undefined)}
                      />
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div
          style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Button tone="default" onClick={() => onConnect()} disabled={atLimit}>
            + Connect another Gmail account
          </Button>
          {atLimit && (
            <span id={MAILBOX_LIMIT_EXPLANATION_ID} style={{ fontSize: 12, color: color.fgMuted }}>
              Your plan includes {inboxLimit} connected {inboxLimit === 1 ? 'inbox' : 'inboxes'} —{' '}
              <Link href="/billing" style={{ color: color.primary }}>
                upgrade for more
              </Link>
              .
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

function ReconnectButton({
  disabled,
  describedBy,
  email,
  onClick,
}: {
  disabled: boolean;
  describedBy: string | undefined;
  email: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Reconnect ${email}`}
      aria-describedby={describedBy}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 26,
        padding: '0 10px',
        background: color.card,
        color: color.fg,
        border: `1px solid ${color.line}`,
        borderRadius: 6,
        fontFamily: font.sans,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      Reconnect
    </button>
  );
}

/** ISO → compact relative age (same shape as SyncNowButton's label). */
function relAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function StatusTag({ tone, children }: { tone: 'primary' | 'muted' | 'danger'; children: string }) {
  const fg = tone === 'primary' ? color.primary : tone === 'danger' ? color.danger : color.fgMuted;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        color: fg,
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

const mutedTextStyle = {
  fontSize: 13,
  color: color.fgSoft,
  lineHeight: 1.55,
  margin: '8px 0 0',
} as const;
