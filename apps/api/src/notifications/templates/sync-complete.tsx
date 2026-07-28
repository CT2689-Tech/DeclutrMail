import { Button, Text } from '@react-email/components';

import { formatCount, renderShell, Shell, type RenderedEmail } from './shell.js';

export interface SyncCompleteEmailInput {
  /** The user's own connected mailbox address, e.g. "you@gmail.com". */
  mailboxEmail: string;
  /** Messages indexed by the initial sync (metadata only). */
  messageCount: number;
  /** Web app origin, e.g. "https://app.declutrmail.com". */
  appUrl: string;
}

const FOOTER = 'You received this because you connected this mailbox to DeclutrMail.';

/** D6 — sent when a mailbox's initial sync reaches `ready`. */
export async function syncCompleteEmail(input: SyncCompleteEmailInput): Promise<RenderedEmail> {
  const messages = formatCount(input.messageCount, 'message', 'messages');
  const triageUrl = `${input.appUrl}/triage`;

  const text = [
    `DeclutrMail finished indexing ${input.mailboxEmail}.`,
    '',
    `${messages} indexed — your senders are grouped and ready to`,
    'triage. The first pass usually takes a few minutes and clears',
    'the bulk of the noise.',
    '',
    `Jump back in: ${triageUrl}`,
    '(Still in setup? That link drops you right back where you left off.)',
    '',
    '— DeclutrMail',
    '',
    FOOTER,
  ].join('\n');

  const html = await renderShell(
    <Shell preview={`${messages} indexed and ready to triage`} footer={FOOTER}>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' }}>
        DeclutrMail finished indexing <strong>{input.mailboxEmail}</strong>.
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 24px' }}>
        {messages} indexed — your senders are grouped and ready to triage. The first pass usually
        takes a few minutes and clears the bulk of the noise.
      </Text>
      <Button
        href={triageUrl}
        style={{
          backgroundColor: '#000000',
          borderRadius: '6px',
          color: '#ffffff',
          display: 'inline-block',
          fontSize: '14px',
          fontWeight: 500,
          padding: '10px 20px',
          textDecoration: 'none',
        }}
      >
        Open Triage
      </Button>
    </Shell>,
  );

  return { subject: 'Your inbox is ready', text, html };
}
