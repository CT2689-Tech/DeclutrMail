'use client';

import { tokens } from '@declutrmail/shared';

const { color, font } = tokens;

/**
 * The mailbox note shown above an action preview — presentational only.
 *
 * Split from `MailboxActionContext` (2026-08-26, D133) so surfaces that
 * already know their mailbox can render it WITHOUT importing
 * `auth-provider`. That import pulls `useMe` and the API client, and the
 * public inbox simulator renders `BatchActionSheet` and `ActivateRuleModal`
 * on a marketing route where the query layer must not land in the chunk.
 * Tree-shaking cannot remove it, because it is per-module.
 */
export function MailboxActionContextView({ mailboxEmail }: { mailboxEmail?: string | undefined }) {
  if (!mailboxEmail) return null;

  return (
    <div
      role="note"
      aria-label={`Gmail account: ${mailboxEmail}`}
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
        {mailboxEmail}
      </strong>
    </div>
  );
}
