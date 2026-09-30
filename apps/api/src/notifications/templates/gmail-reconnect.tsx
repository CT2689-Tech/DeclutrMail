import { Button, Text } from '@react-email/components';
import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export async function gmailReconnectEmail(input: {
  mailboxEmail: string;
  mailboxAccountId: string;
  appUrl: string;
}): Promise<RenderedEmail> {
  const url = `${input.appUrl.replace(/\/$/, '')}/settings#mailbox-${encodeURIComponent(input.mailboxAccountId)}`;
  // Sent for every `InvalidGrantError`: a refused refresh, and also a Gmail
  // permission left unticked at consent — so no "renewing" and no expiry.
  // Nothing here assumes the inbox ever synced: the 2026-09-04 recipient's
  // never had, so "previously synced data" was not theirs to view. Only
  // syncing pauses: an Archive or Delete on a refused grant fails, it does
  // not wait for the reconnect.
  const explanation = `Google isn't granting DeclutrMail access to ${input.mailboxEmail}. Syncing for this inbox is paused until you reconnect it and allow Gmail access.`;
  const footer = 'This is a required account notice; it cannot be turned off.';
  const text = [
    explanation,
    '',
    'Open Settings → Gmail accounts and choose Reconnect for this inbox:',
    url,
    '',
    footer,
  ].join('\n');
  const html = await renderShell(
    <Shell preview="Reconnect Gmail to resume inbox updates." footer={footer}>
      <Eyebrow>Gmail connection needs attention</Eyebrow>
      <Text style={BODY_TEXT}>{explanation}</Text>
      <Text style={BODY_TEXT}>
        Open Settings → Gmail accounts and choose Reconnect for this inbox.
      </Text>
      <Button href={url} style={CTA_BUTTON}>
        Open Gmail accounts
      </Button>
    </Shell>,
  );
  return { subject: `Reconnect Gmail for ${input.mailboxEmail}`, text, html };
}
