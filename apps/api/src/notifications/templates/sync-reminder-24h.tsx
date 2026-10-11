import { Button, Text } from '@react-email/components';

import { postalAddressLine } from '@declutrmail/shared/copy';
import { connectedFooter, fillWs4, WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
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
  /** Owned inbox selected before opening the linked screen. */
  mailboxAccountId: string;
  /** Web app origin. */
  appUrl: string;
  /** True when `users.onboarded_at` is set. */
  onboarded: boolean;
  /**
   * Signed one-click unsubscribe URL. REQUIRED — a re-engagement nudge
   * is the most clearly commercial of the four kinds, so it must never
   * render without a visible opt-out. Tracking params stay off this URL.
   */
  unsubscribeUrl: string;
}

/**
 * D6 — the 24h nudge, sent only when the user has not returned since
 * the sync finished (the EmailSendWorker checks session activity at
 * execution time) and has not opted out of reminders (D165).
 */
export async function syncReminder24hEmail(input: SyncReminderEmailInput): Promise<RenderedEmail> {
  const copy = WS4_COPY.email.syncReminder;
  const appUrl = input.appUrl.replace(/\/$/, '');
  const body = fillWs4(copy.body, { mailboxEmail: input.mailboxEmail });
  const button = input.onboarded ? copy.button.onboarded : copy.button.notOnboarded;
  const destination = emailLink(`${appUrl}${input.onboarded ? '/senders' : '/onboarding'}`, {
    template: 'sync_reminder_24h',
    mailboxId: input.mailboxAccountId,
  });
  const preferencesUrl = `${appUrl}/settings`;
  const footer = connectedFooter('this');

  const text = [
    body,
    '',
    `${button}: ${destination}`,
    '',
    '— DeclutrMail',
    '',
    footer,
    `${WS4_COPY.email.unsubscribe}: ${input.unsubscribeUrl}`,
    `${WS4_COPY.email.preferences}: ${preferencesUrl}`,
    ...(postalAddressLine() ? [postalAddressLine() as string] : []),
  ].join('\n');

  const html = await renderShell(
    <Shell
      preview={body}
      footer={footer}
      optOut={{ unsubscribeUrl: input.unsubscribeUrl, preferencesUrl }}
    >
      <Eyebrow>{copy.subject}</Eyebrow>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        Yesterday DeclutrMail finished scanning{' '}
        <a
          href={`mailto:${input.mailboxEmail}`}
          style={{ color: INK, fontWeight: 600, textDecoration: 'none' }}
        >
          {input.mailboxEmail}
        </a>
        . Your senders are grouped and waiting.
      </Text>
      <Button href={destination} style={CTA_BUTTON}>
        {button}
      </Button>
    </Shell>,
  );

  return { subject: copy.subject, text, html };
}
