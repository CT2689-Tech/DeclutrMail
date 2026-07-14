'use client';

import { Button, tokens } from '@declutrmail/shared';

import { StepShell } from './step-shell';

const { color, font } = tokens;

/**
 * Step 2 — Connect (D108).
 *
 * Explains exactly what the Google consent screen will ask for, then
 * starts the OAuth flow. DeclutrMail requests ONE Gmail scope
 * (`gmail.modify`, per D4): metadata-shaped reads for the sender
 * index + the label/archive mutations the K/A/U/L verbs need. The
 * "what we store" boundary was just shown on step 1 (D107) and is
 * enforced server-side regardless of the scope's nominal breadth.
 *
 * Two render contexts:
 *   - PRE-AUTH (the normal funnel): the CTA starts the signup OAuth
 *     flow; after the Google grant the callback returns to
 *     `/onboarding`, lands authed, and the machine advances to the
 *     sync gate.
 *   - AUTHED with zero active mailboxes (aborted OAuth, or every
 *     mailbox disconnected): same screen, same CTA — `variant`
 *     adjusts the copy so it doesn't pretend the user is new.
 */
export function StepConnect({ variant = 'fresh' }: { variant?: 'fresh' | 'reconnect' }) {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';
  const startUrl = `${apiBase}/api/auth/google/start`;

  return (
    <StepShell
      eyebrow="Step 2 of 5 · Connect"
      title={variant === 'fresh' ? 'Connect your Gmail.' : 'Reconnect your Gmail.'}
      sub={
        variant === 'fresh'
          ? "You'll see Google's consent screen next. Here's what it covers."
          : 'Your account has no connected mailbox right now — reconnect to continue.'
      }
    >
      <ul
        style={{
          listStyle: 'none',
          padding: '16px 20px',
          margin: '0 0 24px',
          width: '100%',
          textAlign: 'left',
          background: color.card,
          border: `1px solid ${color.lineSoft}`,
          borderRadius: 10,
          display: 'grid',
          gap: 10,
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: font.sans,
        }}
      >
        <li>
          <strong style={{ fontWeight: 600 }}>One Gmail permission.</strong>{' '}
          <span style={{ color: color.fgMuted }}>
            Google will ask to let DeclutrMail read, label and archive your mail — that single
            permission powers both the sender scan and the cleanup actions you approve.
          </span>
        </li>
        <li>
          <strong style={{ fontWeight: 600 }}>We still never fetch bodies.</strong>{' '}
          <span style={{ color: color.fgMuted }}>
            The step-1 storage list is the whole list. Full bodies fetched: 0.
          </span>
        </li>
        <li>
          <strong style={{ fontWeight: 600 }}>Connecting changes no email.</strong>{' '}
          <span style={{ color: color.fgMuted }}>
            Connecting only starts the scan. Archive, Unsubscribe, Later, and Delete each show a
            preview with their scope and recovery options before anything changes.
          </span>
        </li>
      </ul>

      <Button
        tone="primary"
        onClick={() => window.location.assign(startUrl)}
        style={{ minWidth: 220 }}
      >
        Continue to Google
      </Button>
    </StepShell>
  );
}
