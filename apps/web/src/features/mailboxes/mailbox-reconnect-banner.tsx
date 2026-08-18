'use client';

import { Button, tokens } from '@declutrmail/shared';

import { useAuth } from '@/features/auth/auth-provider';
import { startMailboxConnect } from '@/features/mailboxes/connect-mailbox-url';

const { color, font } = tokens;

/**
 * Reconnect gate for broken mailboxes the user is NOT currently looking
 * at (D224, D170 critical-trust state).
 *
 * `SyncErrorBanner` covers the active mailbox and covers it better — it
 * reads `/sync/status`, so it can also surface a transient failure and
 * offer a retry. But it is mounted with `me.activeMailboxId` alone, so a
 * SECOND mailbox whose Gmail grant had been revoked was silent on every
 * primary surface: its only markers were inside the account-switcher
 * dialog and the Settings → Mailboxes card, both of which the user has
 * to go looking for. Mail silently stopped arriving for that mailbox.
 * The founder found out from a Sentry billing email (2026-08-18).
 *
 * Driven entirely by `me.mailboxes[].needsReconnect`, which the API now
 * computes server-side with the same rule as `syncStatusNeedsReconnect`.
 * That matters: the alternative was a `/sync/status` observer per
 * mailbox mounted on every page, which is exactly the cost `AccountMenu`
 * defers behind its open-state gate. This surface adds no reads at all.
 *
 * The active mailbox is excluded — `SyncErrorBanner` already owns it, and
 * rendering both would double the same alarm.
 *
 * One row per broken mailbox. Each names its account, because "reconnect
 * Gmail" is ambiguous the moment more than one mailbox exists, and each
 * reconnect is target-bound to that mailbox's id.
 */
export function MailboxReconnectBanner() {
  const { me } = useAuth();

  const broken = (me?.mailboxes ?? []).filter(
    (m) => m.status === 'active' && m.needsReconnect && m.id !== me?.activeMailboxId,
  );

  if (broken.length === 0) return null;

  return (
    <>
      {broken.map((mailbox) => (
        <div
          key={mailbox.id}
          role="alert"
          data-testid="mailbox-reconnect-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            padding: '10px 20px',
            background: color.dangerBg,
            borderBottom: `1px solid ${color.dangerBorder}`,
            fontFamily: font.sans,
          }}
        >
          <span
            style={{
              flex: '1 1 260px',
              fontSize: 13,
              fontWeight: 600,
              color: color.danger,
              minWidth: 0,
            }}
          >
            {`Gmail access expired for ${mailbox.email}. That account has stopped syncing — reconnect it to resume. Your existing DeclutrMail history is safe.`}
          </span>
          <Button tone="default" size="sm" onClick={() => startMailboxConnect(mailbox.id)}>
            Reconnect
          </Button>
        </div>
      ))}
    </>
  );
}
