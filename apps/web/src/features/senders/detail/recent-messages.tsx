'use client';

import { useState } from 'react';
import { EmptyState, tokens } from '@declutrmail/shared';
import { adaptMailMessageRow } from '../api/adapters';
import { useSenderMessages } from '../api/use-sender-messages';
import { absoluteFromIso, fmtSize, relTimeFromIso } from './data';
import type { RecentMessage } from './types';
import { track } from '@/lib/posthog';
import { addBreadcrumb } from '@/lib/sentry';
import { GmailOpenLinkService } from '@/lib/gmail/open-link';
import { useNow } from '@/lib/use-now';

const { color, font, text } = tokens;

/**
 * Recent messages list (D39 #4, D41).
 *
 * Renders sender + subject + Gmail snippet + relative date + size +
 * attachment icon + read/unread dot. Clicking the subject opens the
 * thread in a new Gmail tab. The snippet IS Gmail's own body-derived
 * preview text (D7's "Gmail preview snippet" framing, never called a
 * body or summary in user-facing copy) — DeclutrMail never fetches or
 * stores the full message.
 *
 * The empty state handles "no recent messages" (a fresh add, or a
 * sender that recently went dark) — D211/D212.
 */
export function RecentMessages({
  messages,
  mailboxEmail,
  senderEmail,
  senderId,
}: {
  messages: RecentMessage[];
  mailboxEmail: string | null;
  senderEmail: string;
  senderId?: string;
}) {
  const [scope, setScope] = useState<'all_mail' | 'inbox' | 'archived'>('all_mail');
  const scopedQuery = useSenderMessages(senderId ?? '', {
    scope,
    enabled: scope !== 'all_mail',
  });
  const visibleMessages =
    scope === 'all_mail'
      ? messages
      : (scopedQuery.data?.pages.flatMap((page) => page.data.map(adaptMailMessageRow)) ?? []);
  const scopeLabels = [
    { value: 'all_mail', label: 'Inbox + archived' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'archived', label: 'Archived' },
  ] as const;

  return (
    <section
      aria-label="Recent messages"
      style={{
        fontFamily: font.sans,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <style>{`@media (max-width: 600px) {
        .dm-recent-message-row {
          grid-template-columns: auto minmax(0, 1fr) auto !important;
        }
        .dm-recent-message-size {
          grid-column: 2 / -1;
          justify-self: end;
        }
      }`}</style>
      {/* QA-sender-detail-20260902-11: one heading, no count — a count
          here was just how many rows happened to load. The old caption
          beside it ("subject and the Gmail preview only") restated what
          the rows already show; trust copy belongs at a decision point. */}
      <h2 style={{ margin: 0, fontSize: text.md, fontWeight: 600, color: color.fg }}>
        Recent messages
      </h2>

      {senderId && (
        <div
          role="group"
          aria-label="Message location"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {scopeLabels.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
              style={{
                border: `1px solid ${scope === option.value ? color.primary : color.lineSoft}`,
                background: scope === option.value ? color.primary : 'transparent',
                color: scope === option.value ? color.fgInverse : color.fgMuted,
                borderRadius: 999,
                padding: '6px 10px',
                fontFamily: font.sans,
                fontSize: text.xs,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {scope !== 'all_mail' && scopedQuery.isPending ? (
        <p role="status" style={{ color: color.fgMuted, fontSize: text.sm }}>
          Loading messages…
        </p>
      ) : scope !== 'all_mail' && scopedQuery.isError && !scopedQuery.data ? (
        <button type="button" onClick={() => void scopedQuery.refetch()}>
          Could not load messages. Try again.
        </button>
      ) : visibleMessages.length === 0 ? (
        <EmptyState
          title={
            scope === 'inbox'
              ? 'No Inbox messages'
              : scope === 'archived'
                ? 'No archived messages'
                : 'No recent messages'
          }
          body={
            scope === 'inbox'
              ? 'Try Inbox + archived to see earlier mail from this sender.'
              : scope === 'archived'
                ? 'Messages outside your Inbox will show up here.'
                : 'No current Inbox or archived mail from this sender.'
          }
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
          {visibleMessages.map((m, idx) => (
            <li
              key={m.id}
              style={{
                borderTop: idx === 0 ? 'none' : `1px solid ${color.lineSoft}`,
                padding: '12px 0',
              }}
            >
              <MessageRow message={m} mailboxEmail={mailboxEmail} senderEmail={senderEmail} />
            </li>
          ))}
        </ol>
      )}
      {senderId && scopedQuery.hasNextPage && (
        <button
          type="button"
          disabled={scopedQuery.isFetchingNextPage}
          onClick={() => void scopedQuery.fetchNextPage()}
          style={{
            alignSelf: 'flex-start',
            border: 0,
            padding: '6px 0',
            background: 'transparent',
            color: color.primary,
            fontFamily: font.sans,
            fontSize: text.sm,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {scopedQuery.isFetchingNextPage ? 'Loading more…' : 'Show more messages'}
        </button>
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
  // `useNow()` rather than a bare `new Date()` in the render body: this
  // route is server-prefetched, so a render-time clock hands the server
  // and the client different values and arms a hydration mismatch (D200).
  // Null on the server and the first client render; the real clock lands
  // as an ordinary post-mount state update — the same contract the
  // Activity feed's timestamps already use.
  const now = useNow();
  const relative = now === null ? '' : relTimeFromIso(message.receivedAt, new Date(now));
  const absolute = now === null ? '' : absoluteFromIso(message.receivedAt);

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
      className="dm-recent-message-row"
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
              fontSize: text.md,
              fontWeight: message.unread ? 600 : 500,
              color: color.fg,
              textDecoration: 'none',
              lineHeight: 1.35,
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
              fontSize: text.md,
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
            fontSize: text.sm,
            color: color.fgMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginTop: 2,
          }}
        >
          {message.snippet}
        </span>
        {message.location && (
          <span
            style={{
              display: 'inline-block',
              marginTop: 4,
              fontSize: text.xs,
              color: color.fgMuted,
            }}
          >
            {message.location === 'inbox' ? 'Inbox' : 'Archived'}
          </span>
        )}
      </div>
      {/* D41 keeps the RELATIVE label visible; the exact instant rides
          along in `title` + a machine-readable `dateTime`, so nothing
          about the scan-ability changes and the value becomes checkable
          against Gmail. Additive — no D41 amendment needed. */}
      <time
        dateTime={message.receivedAt}
        // Omit `title` until the clock exists rather than emitting
        // `title=""` on the server render.
        {...(absolute ? { title: absolute } : {})}
        style={{
          fontSize: text.xs,
          color: color.fgMuted,
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {relative}
      </time>
      <span
        className="dm-recent-message-size"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: text.xs,
          fontVariantNumeric: 'tabular-nums',
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
