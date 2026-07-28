import { Button, Text } from '@react-email/components';

import {
  BODY_TEXT,
  CTA_BUTTON,
  DISPLAY,
  Eyebrow,
  INK,
  renderShell,
  Shell,
  type RenderedEmail,
} from './shell.js';

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
      <Eyebrow>Deletion scheduled</Eyebrow>
      {/* The date is the one fact that decides whether the reader acts,
          so it gets the display treatment rather than bold-in-a-line. */}
      <Text
        style={{
          color: INK,
          fontFamily: DISPLAY,
          fontSize: '30px',
          fontWeight: 300,
          letterSpacing: '-0.02em',
          lineHeight: '36px',
          margin: '0 0 18px',
        }}
      >
        {input.scheduledFor}
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        On that date, everything DeclutrMail stored about your mailboxes — sender names and
        addresses, subject lines, snippets, labels, and dates — will be permanently deleted. Nothing
        in your Gmail account itself is touched.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>Changed your mind?</Text>
      <Button href={input.cancelUrl} style={CTA_BUTTON}>
        Cancel deletion
      </Button>
    </Shell>,
  );

  return { subject: 'Your DeclutrMail deletion is scheduled', text, html };
}
