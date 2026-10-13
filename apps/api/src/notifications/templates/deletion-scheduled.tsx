import { Button, Text } from '@react-email/components';

import { WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';

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
    'On that date, everything DeclutrMail saved about your Gmail accounts will be permanently deleted: sender names and addresses, subject lines, preview snippets, labels and dates. Nothing in your Gmail account changes.',
    '',
    'Changed your mind? Cancel any time before then:',
    emailLink(input.cancelUrl, { template: 'deletion_scheduled' }),
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
        On that date, everything DeclutrMail saved about your Gmail accounts will be permanently
        deleted: sender names and addresses, subject lines, preview snippets, labels and dates.
        Nothing in your Gmail account changes.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>Changed your mind?</Text>
      <Button
        href={emailLink(input.cancelUrl, { template: 'deletion_scheduled' })}
        style={CTA_BUTTON}
      >
        {WS4_COPY.email.deletion.button}
      </Button>
    </Shell>,
  );

  return { subject: 'Your DeclutrMail deletion is scheduled', text, html };
}
