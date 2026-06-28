'use client';

import Link from 'next/link';
import { Button, Card, tokens } from '@declutrmail/shared';
import type { MeMailbox } from '@/features/auth/api/use-me';

const { color, font } = tokens;

/**
 * Settings → Mailboxes (D114 "Inboxes" section, scoped to what exists).
 *
 * Read-only list of connected Gmail accounts (status + initial-sync
 * readiness + active marker) plus the connect-another affordance. The
 * switch / disconnect / reconnect flows stay in the header account
 * menu — this card POINTS there instead of rebuilding them (U23
 * constraint: reuse, don't rebuild).
 *
 * Inbox limit (D19 tiers): `connect` disables at the tier's
 * `inboxLimit` with an upgrade pointer to /billing. Disconnected
 * accounts don't count against the limit (the BE reactivates them via
 * the same OAuth flow).
 */
export function MailboxesCard({
  mailboxes,
  activeMailboxId,
  inboxLimit,
  onConnect,
}: {
  mailboxes: MeMailbox[];
  activeMailboxId: string | null;
  /** The tier's connected-inbox allowance, or null while tier unknown. */
  inboxLimit: number | null;
  onConnect: () => void;
}) {
  const activeCount = mailboxes.filter((m) => m.status === 'active').length;
  const atLimit = inboxLimit !== null && activeCount >= inboxLimit;

  return (
    <Card padding={0}>
      <div style={{ padding: '18px 20px', fontFamily: font.sans }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: color.fg }}>Mailboxes</h3>
        <p style={mutedTextStyle}>
          Connected Gmail accounts. Switch, disconnect, or reconnect from the account menu in the
          top bar.
        </p>

        {mailboxes.length === 0 ? (
          <p style={mutedTextStyle}>No mailboxes connected yet — connect one to start.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
            {mailboxes.map((m, i) => {
              const isActive = m.id === activeMailboxId && m.status === 'active';
              return (
                <li
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
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
                      background: m.status === 'disconnected' ? color.fgMuted : color.primary,
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13.5,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: m.status === 'disconnected' ? color.fgMuted : color.fg,
                    }}
                  >
                    {m.email}
                  </span>
                  {isActive && <StatusTag tone="primary">Active</StatusTag>}
                  {m.status === 'disconnected' ? (
                    <StatusTag tone="muted">Disconnected</StatusTag>
                  ) : m.readiness === 'queued' || m.readiness === 'syncing' ? (
                    <StatusTag tone="muted">Syncing…</StatusTag>
                  ) : m.readiness === 'failed' ? (
                    <StatusTag tone="danger">Sync failed</StatusTag>
                  ) : (
                    <StatusTag tone="muted">Ready</StatusTag>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button tone="default" onClick={onConnect} disabled={atLimit}>
            + Connect another Gmail account
          </Button>
          {atLimit && (
            <span style={{ fontSize: 12, color: color.fgMuted }}>
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
