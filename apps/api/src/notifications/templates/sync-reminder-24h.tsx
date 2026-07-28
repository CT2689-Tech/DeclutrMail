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
}

/**
 * D6 — the 24h nudge, sent only when the user has not returned since
 * the sync finished (the EmailSendWorker checks session activity at
 * execution time) and has not opted out of reminders (D165).
 */
export async function syncReminder24hEmail(input: SyncReminderEmailInput): Promise<RenderedEmail> {
  const footer = `You can turn off reminder emails at ${input.appUrl}/settings.`;
  const triageUrl = `${input.appUrl}/triage`;

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
  ].join('\n');

  const html = await renderShell(
    <Shell preview="Five minutes of triage is usually enough." footer={footer}>
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
