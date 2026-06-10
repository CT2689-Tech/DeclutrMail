'use client';

// Consumers: senders-screen.tsx, detail/sender-detail-page.tsx,
// features/triage/triage-screen.tsx (D9 Wave 2 PR). Cross-feature per
// ADR-0007's second-consumer rule, but D220's launch allowlist gates
// packages/shared additions — so the single source of truth lives here
// in the senders feature (the surface that owns unsubscribe), and
// triage imports across the feature boundary like it already does for
// `activityKeys`.

import { tokens } from '@declutrmail/shared';
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
  const composeUrl = gmailComposeUrlFromMailto(mailtoUrl);
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
          color: '#FFFFFF',
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
