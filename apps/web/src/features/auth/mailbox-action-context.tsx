'use client';

import { tokens } from '@declutrmail/shared';

import { getActiveMailboxEmail, useOptionalAuth } from './auth-provider';

const { color, font } = tokens;

/**
 * Persistent account identity for any confirmation that can mutate Gmail.
 * An explicit email keeps stories/tests deterministic; production dialogs
 * fall back to the active mailbox from AuthProvider.
 */
export function MailboxActionContext({ mailboxEmail }: { mailboxEmail?: string | undefined }) {
  const auth = useOptionalAuth();
  const email = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

  if (!email) return null;

  return (
    <div
      role="note"
      aria-label={`Gmail account: ${email}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        padding: '7px 10px',
        borderRadius: 7,
        border: `1px solid ${color.line}`,
        background: color.paper,
        color: color.fgSoft,
        fontFamily: font.sans,
        fontSize: 11.5,
        lineHeight: 1.4,
      }}
    >
      <span>Gmail account</span>
      <strong
        style={{
          color: color.fg,
          fontFamily: font.mono,
          fontSize: 11,
          overflowWrap: 'anywhere',
        }}
      >
        {email}
      </strong>
    </div>
  );
}
