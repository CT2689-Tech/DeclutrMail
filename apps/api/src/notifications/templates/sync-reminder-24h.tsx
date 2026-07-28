import { Button, Text } from '@react-email/components';

import {
  BODY_TEXT,
  CTA_BUTTON,
  Eyebrow,
  INK,
  renderShell,
  Shell,
  type RenderedEmail,
} from './shell.js';

export interface SyncReminderEmailInput {
  /** The user's own connected mailbox address. */
  mailboxEmail: string;
  /** Web app origin. */
  appUrl: string;
  /**
   * Signed one-click unsubscribe URL. REQUIRED — a re-engagement nudge
   * is the most clearly commercial of the four kinds, so it must never
   * render without a visible opt-out.
   */
  unsubscribeUrl: string;
}

/**
 * D6 — the 24h nudge, sent only when the user has not returned since
 * the sync finished (the EmailSendWorker checks session activity at
 * execution time) and has not opted out of reminders (D165).
 */
export async function syncReminder24hEmail(input: SyncReminderEmailInput): Promise<RenderedEmail> {
  const footer = 'You received this because you connected this mailbox to DeclutrMail.';
  const triageUrl = `${input.appUrl}/triage`;
  const preferencesUrl = `${input.appUrl}/settings`;

  const text = [
    `Yesterday DeclutrMail finished indexing ${input.mailboxEmail}.`,
    '',
    'Your senders are grouped and waiting. Five minutes of triage is',
    'usually enough to feel the difference.',
    '',
    `Pick it up here: ${triageUrl}`,
    '',
    '— DeclutrMail',
    '',
    footer,
    // The plain-text alternative carries the opt-out too — a text-only
    // reader must not be left without one.
    `Unsubscribe: ${input.unsubscribeUrl}`,
    `Email preferences: ${preferencesUrl}`,
  ].join('\n');

  const html = await renderShell(
    <Shell
      preview="Five minutes of triage is usually enough."
      footer={footer}
      optOut={{ unsubscribeUrl: input.unsubscribeUrl, preferencesUrl }}
    >
      <Eyebrow>Still waiting for you</Eyebrow>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        Yesterday DeclutrMail finished indexing{' '}
        {/* Explicit anchor so Gmail does not autolink the bare address
            into default-blue underlined link text. */}
        <a
          href={`mailto:${input.mailboxEmail}`}
          style={{ color: INK, fontWeight: 600, textDecoration: 'none' }}
        >
          {input.mailboxEmail}
        </a>
        .
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>
        Your senders are grouped and waiting. Five minutes of triage is usually enough to feel the
        difference.
      </Text>
      <Button href={triageUrl} style={CTA_BUTTON}>
        Open Triage
      </Button>
    </Shell>,
  );

  return { subject: 'Your inbox is still ready', text, html };
}
