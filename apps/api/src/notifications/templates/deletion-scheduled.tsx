import { Button, Text } from '@react-email/components';

import { renderShell, Shell, type RenderedEmail } from './shell.js';

export interface DeletionScheduledEmailInput {
  /** Human-readable date the deletion executes, e.g. "June 18, 2026". */
  scheduledFor: string;
  /**
   * Cancel-link URL with the one-time token already embedded — the
   * D232 cancel slot. U22 builds this URL; this template only places
   * it. MUST be a DeclutrMail URL.
   */
  cancelUrl: string;
}

const FOOTER = 'This is a required account notice; it cannot be turned off.';

/** D232 — sent when account deletion is scheduled (consumed by U22). */
export async function deletionScheduledEmail(
  input: DeletionScheduledEmailInput,
): Promise<RenderedEmail> {
  const text = [
    `Your DeclutrMail account is scheduled for deletion on ${input.scheduledFor}.`,
    '',
    'On that date, everything DeclutrMail stored about your mailboxes —',
    'sender names and addresses, subject lines, snippets, labels, and',
    'dates — will be permanently deleted. Nothing in your Gmail account',
    'itself is touched.',
    '',
    'Changed your mind? Cancel any time before then:',
    input.cancelUrl,
    '',
    '— DeclutrMail',
    '',
    FOOTER,
  ].join('\n');

  const html = await renderShell(
    <Shell preview={`Cancel any time before ${input.scheduledFor}.`} footer={FOOTER}>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' }}>
        Your DeclutrMail account is scheduled for deletion on <strong>{input.scheduledFor}</strong>.
      </Text>
      <Text style={{ fontSize: '16px', lineHeight: '24px', margin: '0 0 24px' }}>
        On that date, everything DeclutrMail stored about your mailboxes — sender names and
        addresses, subject lines, snippets, labels, and dates — will be permanently deleted. Nothing
        in your Gmail account itself is touched.
      </Text>
      <Button
        href={input.cancelUrl}
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
        Cancel deletion
      </Button>
    </Shell>,
  );

  return { subject: 'Your DeclutrMail deletion is scheduled', text, html };
}
