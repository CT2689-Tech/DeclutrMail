'use client';

import type { ReactNode } from 'react';
import { Button, tokens } from '@declutrmail/shared';
import {
  GMAIL_CONNECTION_DATA_INVENTORY,
  GMAIL_DERIVED_DATA_INVENTORY,
  GMAIL_MESSAGE_STORAGE_LABELS,
  GMAIL_OAUTH_ACCESS,
} from '@declutrmail/shared/contracts';

import { StepShell } from './step-shell';

const { color, font } = tokens;

/**
 * Step 2 — Connect (D108).
 *
 * Explains what the Google consent screen will ask for, then
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
      <ol
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
        <ConsentStep number="1" title="Access">
          Google asks for {GMAIL_OAUTH_ACCESS.map((item) => item.label.toLowerCase()).join(' and ')}
          . Connecting grants that access, but does not change any email.
        </ConsentStep>
        <ConsentStep number="2" title="Fetched during the scan">
          DeclutrMail fetches only sender and message metadata used to group mail and show previews.
          Full bodies and attachments are not fetched.
          <ConsentDetails label="Show fetched fields" items={GMAIL_MESSAGE_STORAGE_LABELS} />
        </ConsentStep>
        <ConsentStep number="3" title="Stored in DeclutrMail">
          The fetched metadata is stored in your mailbox index along with connection records, sender
          facts, your choices, and records needed to run and reverse eligible actions. Settings →
          Privacy &amp; Data lists the purpose and retention for every dataset.
          <ConsentDetails
            label="Show stored and derived data"
            items={[
              ...GMAIL_CONNECTION_DATA_INVENTORY.map((item) => item.label),
              ...GMAIL_DERIVED_DATA_INVENTORY.map((item) => item.label),
            ]}
          />
        </ConsentStep>
        <ConsentStep number="4" title="Actions you approve">
          After the scan, every Archive, Unsubscribe, Later, or Delete confirmation identifies the
          affected mail, future-mail behavior, and available recovery before anything changes. Keep
          records a sender choice without moving mail.
        </ConsentStep>
      </ol>

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

function ConsentStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 10 }}>
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: color.primarySoft,
          color: color.primaryDeep,
          fontFamily: font.mono,
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        {number}
      </span>
      <span>
        <strong style={{ display: 'block', fontWeight: 600, color: color.fg }}>{title}</strong>
        <span style={{ color: color.fgMuted }}>{children}</span>
      </span>
    </li>
  );
}

/** Progressive disclosure; every field label comes from the D245 registry. */
function ConsentDetails({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <details style={{ marginTop: 5 }}>
      <summary style={{ color: color.primary, cursor: 'pointer', fontSize: 12 }}>{label}</summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
