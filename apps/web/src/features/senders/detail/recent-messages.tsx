'use client';

import { Eyebrow, EmptyState, tokens } from '@declutrmail/shared';
import { fmtSize, relTimeFromIso } from './data';
import type { RecentMessage } from './types';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';

const { color, font, radius } = tokens;

/**
 * Recent messages list (D39 #4, D41).
 *
 * Renders sender + subject + Gmail snippet + relative date + size +
 * attachment icon + read/unread dot. Clicking the subject opens the
 * thread in a new Gmail tab — DeclutrMail never renders bodies (D7).
 *
 * The empty state handles "no recent messages" (a fresh add, or a
 * sender that recently went dark) — D211/D212.
 */
export function RecentMessages({
  messages,
  mailboxEmail,
  senderEmail,
}: {
  messages: RecentMessage[];
  mailboxEmail: string | null;
  senderEmail: string;
}) {
  return (
    <section
      aria-label="Recent messages"
      style={{
        background: color.card,
        border: `1px solid ${color.line}`,
        borderRadius: radius.lg,
        padding: '16px 20px',
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <div>
          <Eyebrow>Recent messages</Eyebrow>
          <h2
            style={{
              margin: '4px 0 0',
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: color.fg,
            }}
          >
            Last {messages.length} from this sender
          </h2>
        </div>
        <span
          style={{
            fontFamily: font.mono,
            fontSize: 10.5,
            color: color.fgMuted,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          Opens in Gmail · we never render bodies
        </span>
      </div>

      {messages.length === 0 ? (
        <EmptyState
          title="No recent messages"
          body="Once a new message arrives from this sender it will appear here. We never store the body — only what you see now."
        />
      ) : (
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {messages.map((m, idx) => (
            <li
              key={m.id}
              style={{
                borderTop: idx === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                padding: '10px 0',
              }}
            >
              <MessageRow message={m} mailboxEmail={mailboxEmail} senderEmail={senderEmail} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MessageRow({
  message,
  mailboxEmail,
  senderEmail,
}: {
  message: RecentMessage;
  mailboxEmail: string | null;
  senderEmail: string;
}) {
  const gmailHref = mailboxEmail
    ? GmailOpenLinkService.buildOpenLink({
        mailboxEmail,
        gmailMessageId: message.providerMessageId,
        senderEmail,
        subject: message.subject,
        internalDate: message.receivedAt,
      })
    : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto',
        gap: 12,
        alignItems: 'center',
        minWidth: 0,
      }}
    >
      <span
        aria-label={message.unread ? 'Unread' : 'Read'}
        title={message.unread ? 'Unread' : 'Read'}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: message.unread ? color.primary : 'transparent',
          border: `1.5px solid ${message.unread ? color.primary : color.border}`,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <div style={{ minWidth: 0 }}>
        {gmailHref ? (
          <a
            href={gmailHref}
            target="_blank"
            rel="noopener noreferrer"
            // D38 session-3: per-row Gmail deep-link instrumentation.
            // The "Open all in Gmail" header link already fires this
            // event (source='sender_detail_open_all', kind='all_from_
            // sender'); the per-row click was previously silent.
            // Privacy (D7): no subject / snippet / address in the event
            // payload — only the source surface + deep-link shape.
            onClick={() => {
              void track('gmail_deep_link_opened', {
                source: 'recent_messages_row',
                deep_link_kind: 'thread',
              });
              addBreadcrumb({
                category: 'navigation',
                message: 'gmail-deep-link: recent-messages-row',
                level: 'info',
              });
            }}
            style={{
              display: 'block',
              fontSize: 13.5,
              fontWeight: message.unread ? 600 : 500,
              color: color.fg,
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {message.subject}
          </a>
        ) : (
          <span
            style={{
              display: 'block',
              fontSize: 13.5,
              fontWeight: message.unread ? 600 : 500,
              color: color.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {message.subject}
          </span>
        )}
        <span
          style={{
            display: 'block',
            fontSize: 12,
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}
        >
          {message.snippet}
        </span>
      </div>
      <span
        style={{
          fontFamily: font.mono,
          fontSize: 11,
          color: color.fgSoft,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {relTimeFromIso(message.receivedAt)}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: font.mono,
          fontSize: 11,
          color: color.fgMuted,
          whiteSpace: 'nowrap',
        }}
      >
        {message.hasAttachment && (
          <span aria-label="Has attachment" title="Has attachment">
            <PaperclipIcon />
          </span>
        )}
        {fmtSize(message.sizeBytes)}
      </span>
    </div>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width={11}
      height={11}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}
