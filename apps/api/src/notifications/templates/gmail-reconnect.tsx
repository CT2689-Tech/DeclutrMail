import { Button, Text } from '@react-email/components';
import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export async function gmailReconnectEmail(input: {
  mailboxEmail: string;
  mailboxAccountId: string;
  appUrl: string;
}): Promise<RenderedEmail> {
  const url = `${input.appUrl.replace(/\/$/, '')}/settings#mailbox-${encodeURIComponent(input.mailboxAccountId)}`;
  const explanation = `Gmail access needs renewing for ${input.mailboxEmail}. New inbox updates are paused until you reconnect this account and allow Gmail access.`;
  const footer = 'This is a required account notice; it cannot be turned off.';
  const text = [
    explanation,
    '',
    'Open your connected accounts and choose Reconnect for this inbox:',
    url,
    '',
    'You can still view previously synced data. Other connected inboxes are unaffected.',
    '',
    footer,
  ].join('\n');
  const html = await renderShell(
    <Shell preview="Reconnect Gmail to resume inbox updates." footer={footer}>
      <Eyebrow>Gmail connection needs attention</Eyebrow>
      <Text style={BODY_TEXT}>{explanation}</Text>
      <Text style={BODY_TEXT}>
        You can still view previously synced data. Open your connected accounts and choose Reconnect
        for this inbox.
      </Text>
      <Button href={url} style={CTA_BUTTON}>
        Review Gmail connection
      </Button>
    </Shell>,
  );
  return { subject: `Reconnect Gmail for ${input.mailboxEmail}`, text, html };
}
