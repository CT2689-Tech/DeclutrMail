import { Button, Text } from '@react-email/components';

import {
  BODY_TEXT,
  CTA_BUTTON,
  Eyebrow,
  formatCount,
  formatNumber,
  HERO_NUMERAL,
  INK,
  MUTED,
  renderShell,
  Shell,
  SOFT,
  type RenderedEmail,
} from './shell.js';

export interface SyncCompleteEmailInput {
  /** The user's own connected mailbox address, e.g. "you@gmail.com". */
  mailboxEmail: string;
  /** Messages indexed by the initial sync (metadata only). */
  messageCount: number;
  /** Web app origin, e.g. "https://app.declutrmail.com". */
  appUrl: string;
  /**
   * Signed one-click unsubscribe URL. REQUIRED, not optional: this kind
   * is opt-out-able, so shipping it without a visible unsubscribe link
   * is a CAN-SPAM/GDPR defect. Required means the type system refuses
   * to render a non-compliant send.
   */
  unsubscribeUrl: string;
}

const FOOTER = 'You received this because you connected this mailbox to DeclutrMail.';

/** D6 — sent when a mailbox's initial sync reaches `ready`. */
export async function syncCompleteEmail(input: SyncCompleteEmailInput): Promise<RenderedEmail> {
  const messages = formatCount(input.messageCount, 'message', 'messages');
  const triageUrl = `${input.appUrl}/triage`;
  const preferencesUrl = `${input.appUrl}/settings`;

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
    // The plain-text alternative carries the opt-out too — a text-only
    // reader must not be left without one.
    `Unsubscribe: ${input.unsubscribeUrl}`,
    `Email preferences: ${preferencesUrl}`,
  ].join('\n');

  const html = await renderShell(
    <Shell
      preview={`${messages} indexed and ready to triage`}
      footer={FOOTER}
      optOut={{ unsubscribeUrl: input.unsubscribeUrl, preferencesUrl }}
    >
      <Eyebrow>Your inbox is ready</Eyebrow>

      {/* Hero numeral — the count is the news, so it leads at display
          size instead of sitting mid-paragraph. */}
      <Text style={{ ...HERO_NUMERAL, margin: '0 0 4px' }}>{formatNumber(input.messageCount)}</Text>
      <Text style={{ color: SOFT, fontSize: '15px', lineHeight: '22px', margin: '0 0 22px' }}>
        {input.messageCount === 1 ? 'message' : 'messages'} indexed from{' '}
        {/* Rendered as an explicit anchor so Gmail does not autolink the
            bare address into default-blue underlined link text. `mailto:`
            with inherited styling keeps it looking like the prose it is. */}
        <a
          href={`mailto:${input.mailboxEmail}`}
          style={{ color: INK, fontWeight: 600, textDecoration: 'none' }}
        >
          {input.mailboxEmail}
        </a>
      </Text>

      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>
        Your senders are grouped and ready to triage. The first pass usually takes a few minutes and
        clears the bulk of the noise.
      </Text>

      <Button href={triageUrl} style={CTA_BUTTON}>
        Open Triage
      </Button>

      <Text style={{ color: MUTED, fontSize: '13px', lineHeight: '19px', margin: '18px 0 0' }}>
        Still in setup? That link drops you right back where you left off.
      </Text>
    </Shell>,
  );

  return { subject: 'Your inbox is ready', text, html };
}
