import { Button, Text } from '@react-email/components';

import { WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export async function gmailReconnectEmail(input: {
  mailboxEmail: string;
  mailboxAccountId: string;
  appUrl: string;
}): Promise<RenderedEmail> {
  const url = emailLink(
    `${input.appUrl.replace(/\/$/, '')}/settings#mailbox-${encodeURIComponent(input.mailboxAccountId)}`,
    { template: 'gmail_reconnect' },
  );
  // Sent for every `InvalidGrantError`: a refused refresh, and also a Gmail
  // permission left unticked at consent — so no "renewing" and no expiry.
  // Nothing here assumes the inbox ever synced: the 2026-09-04 recipient's
  // never had, so "previously synced data" was not theirs to view. Only
  // syncing pauses: an Archive or Delete on a refused grant fails, it does
  // not wait for the reconnect.
  const explanation = `DeclutrMail lost access to ${input.mailboxEmail}. Updates for this Gmail account are paused until you reconnect and allow Gmail access.`;
  const footer = 'This is a required account notice; it cannot be turned off.';
  const text = [
    explanation,
    '',
    'Open Settings → Gmail accounts and choose Reconnect for this account:',
    url,
    '',
    footer,
  ].join('\n');
  const html = await renderShell(
    <Shell preview="Reconnect Gmail to keep DeclutrMail up to date." footer={footer}>
      <Eyebrow>Gmail connection needs attention</Eyebrow>
      <Text style={BODY_TEXT}>{explanation}</Text>
      <Text style={BODY_TEXT}>
        Open Settings → Gmail accounts and choose Reconnect for this account:
      </Text>
      <Button href={url} style={CTA_BUTTON}>
        {WS4_COPY.email.reconnect.button}
      </Button>
    </Shell>,
  );
  return { subject: `Reconnect Gmail for ${input.mailboxEmail}`, text, html };
}
