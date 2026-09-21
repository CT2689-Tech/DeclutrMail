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

const { color, font, text, radius } = tokens;

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
      title={variant === 'fresh' ? 'Connect your Gmail.' : 'Reconnect your Gmail.'}
      sub={
        variant === 'fresh'
          ? "Google's consent screen is next."
          : 'No mailbox is connected right now.'
      }
    >
      <ol
        style={{
          listStyle: 'none',
          padding: '16px 0',
          margin: '8px 0 24px',
          width: '100%',
          textAlign: 'left',
          borderTop: `1px solid ${color.line}`,
          borderBottom: `1px solid ${color.line}`,
          display: 'grid',
          gap: 12,
          fontSize: text.md,
          lineHeight: 1.5,
          fontFamily: font.sans,
        }}
      >
        {/* A consent disclosure, so it stays complete — but each step is
            at most two sentences; the field lists sit behind <details>. */}
        <ConsentStep number="1" title="Access">
          Google asks for {GMAIL_OAUTH_ACCESS.map((item) => item.label.toLowerCase()).join(' and ')}
          . Connecting grants that access, but does not change any email.
        </ConsentStep>
        <ConsentStep number="2" title="Fetched during the scan">
          Only the sender and message metadata used to group email and show previews. Full bodies
          and attachments are not fetched.
          <ConsentDetails label="Show fetched fields" items={GMAIL_MESSAGE_STORAGE_LABELS} />
        </ConsentStep>
        <ConsentStep number="3" title="Stored in DeclutrMail">
          That metadata, plus connection records, sender facts, your decisions, and the records
          needed to run and reverse actions. Settings → Privacy &amp; data lists every dataset.
          <ConsentDetails
            label="Show stored and derived data"
            items={[
              ...GMAIL_CONNECTION_DATA_INVENTORY.map((item) => item.label),
              ...GMAIL_DERIVED_DATA_INVENTORY.map((item) => item.label),
            ]}
          />
        </ConsentStep>
        <ConsentStep number="4" title="Actions you approve">
          Every Archive, Unsubscribe, Later or Delete shows what moves and what can be undone,
          before anything changes.
        </ConsentStep>
      </ol>

      <Button
        tone="primary"
        size="lg"
        onClick={() => window.location.assign(startUrl)}
        style={{ minWidth: 220, height: 44 }}
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
          borderRadius: radius.pill,
          display: 'grid',
          placeItems: 'center',
          background: color.primarySoft,
          color: color.primaryDeep,
          fontFamily: font.mono,
          fontSize: text.xs,
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
      <summary style={{ color: color.primary, cursor: 'pointer', fontSize: text.sm }}>
        {label}
      </summary>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
