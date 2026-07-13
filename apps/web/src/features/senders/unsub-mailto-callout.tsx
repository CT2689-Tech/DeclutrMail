'use client';

// Consumers: senders-screen.tsx, detail/sender-detail-page.tsx,
// features/triage/triage-screen.tsx (D9 Wave 2 PR). Cross-feature per
// ADR-0007's second-consumer rule, but D220's launch allowlist gates
// packages/shared additions — so the single source of truth lives here
// in the senders feature (the surface that owns unsubscribe), and
// triage imports across the feature boundary like it already does for
// `activityKeys`.

import { tokens } from '@declutrmail/shared';
import { getActiveMailboxEmail, useOptionalAuth } from '@/features/auth/auth-provider';
import { gmailComposeUrlFromMailto } from '@/lib/gmail-links';

const { color, font } = tokens;

/**
 * The D230 manual-unsubscribe affordance. Rendered AFTER an
 * unsubscribe intent records for a `mailto`-method sender: the user —
 * not DeclutrMail — sends the opt-out, because list processors verify
 * the subscribed address (mail from a no-reply would silently fail).
 * The button opens Gmail's compose window prefilled from the sender's
 * `mailto:` List-Unsubscribe URL; the user hits Send.
 *
 * Renders nothing when the mailto URL can't be parsed into a compose
 * link — never a broken affordance.
 */
export function UnsubMailtoCallout({
  senderName,
  mailtoUrl,
  onDismiss,
}: {
  senderName: string;
  mailtoUrl: string;
  /** Present on transient (post-confirm) placements; omit for persistent ones. */
  onDismiss?: () => void;
}) {
  const auth = useOptionalAuth();
  const mailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const composeUrl = mailboxEmail ? gmailComposeUrlFromMailto(mailboxEmail, mailtoUrl) : null;
  if (!composeUrl) return null;

  return (
    <div
      role="status"
      data-testid="unsub-mailto-callout"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px 10px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <span style={{ flex: 1, fontSize: 13, color: color.fg, lineHeight: 1.5 }}>
        <strong style={{ fontWeight: 600 }}>One step left for {senderName}.</strong>{' '}
        <span style={{ color: color.fgSoft }}>
          Their list takes unsubscribes by email, and it must come from your address — so
          DeclutrMail never sends it for you. The compose opens prefilled; you just hit Send.
        </span>
      </span>
      <a
        href={composeUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          background: color.primary,
          color: color.fgInverse,
          borderRadius: 6,
          padding: '5px 12px',
          fontSize: 12,
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        Open Gmail compose
      </a>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Bulk mailto follow-up. A recorded intent is not a sent request: every
 * email-based list stays visible here until the user opens and sends its
 * prefilled Gmail draft.
 */
export function UnsubMailtoChecklist({
  items,
  onDismiss,
}: {
  items: ReadonlyArray<{ senderName: string; mailtoUrl: string }>;
  onDismiss: () => void;
}) {
  const auth = useOptionalAuth();
  const mailboxEmail = auth ? getActiveMailboxEmail(auth.me) : null;
  const drafts = items.flatMap((item) => {
    const composeUrl = mailboxEmail
      ? gmailComposeUrlFromMailto(mailboxEmail, item.mailtoUrl)
      : null;
    return composeUrl ? [{ ...item, composeUrl }] : [];
  });
  if (drafts.length === 0) return null;

  return (
    <section
      aria-label="Email unsubscribe drafts"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        background: color.primarySoft,
        border: `1px solid ${color.primaryBorder}`,
        borderRadius: 10,
        fontFamily: font.sans,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <strong style={{ color: color.fg, fontSize: 13 }}>
            {drafts.length} email unsubscribe draft{drafts.length === 1 ? '' : 's'} still{' '}
            {drafts.length === 1 ? 'needs' : 'need'} you
          </strong>
          <p style={{ margin: '3px 0 0', color: color.fgSoft, fontSize: 12.5, lineHeight: 1.45 }}>
            DeclutrMail recorded these decisions but did not send the email requests. Open each
            prefilled Gmail draft and press Send from the subscribed account.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss email unsubscribe drafts"
          style={{
            background: 'transparent',
            border: 'none',
            color: color.fgMuted,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {drafts.map((draft) => (
          <li
            key={`${draft.senderName}:${draft.mailtoUrl}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span
              style={{ minWidth: 0, color: color.fg, fontSize: 12.5, overflowWrap: 'anywhere' }}
            >
              {draft.senderName}
            </span>
            <a
              href={draft.composeUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: color.fgInverse,
                background: color.primary,
                borderRadius: 6,
                padding: '5px 10px',
                fontSize: 12,
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Open draft
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
