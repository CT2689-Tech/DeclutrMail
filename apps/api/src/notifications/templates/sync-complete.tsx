import { Button, Text } from '@react-email/components';

import { postalAddressLine } from '@declutrmail/shared/copy';
import { connectedFooter, pluralWs4, WS4_COPY } from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
import {
  BODY_TEXT,
  CTA_BUTTON,
  Eyebrow,
  formatNumber,
  HERO_NUMERAL,
  INK,
  renderShell,
  Shell,
  SOFT,
  type RenderedEmail,
} from './shell.js';

export interface SyncCompleteEmailInput {
  /** The user's own connected mailbox address, e.g. "you@gmail.com". */
  mailboxEmail: string;
  /** Owned inbox selected before opening the linked screen. */
  mailboxAccountId: string;
  /** Messages indexed by the initial sync (metadata only). */
  messageCount: number;
  /** Web app origin, e.g. "https://app.declutrmail.com". */
  appUrl: string;
  /** True when `users.onboarded_at` is set. */
  onboarded: boolean;
  /**
   * Signed one-click unsubscribe URL. REQUIRED, not optional: this kind
   * is opt-out-able, so shipping it without a visible unsubscribe link
   * is a CAN-SPAM/GDPR defect. Required means the type system refuses
   * to render a non-compliant send. Tracking params stay off this URL.
   */
  unsubscribeUrl: string;
}

/** D6 — sent when a mailbox's initial sync reaches `ready`. */
export async function syncCompleteEmail(input: SyncCompleteEmailInput): Promise<RenderedEmail> {
  const copy = WS4_COPY.email.syncComplete;
  const appUrl = input.appUrl.replace(/\/$/, '');
  const body = pluralWs4(copy.body, input.messageCount, {
    n: formatNumber(input.messageCount),
    mailboxEmail: input.mailboxEmail,
  });
  const button = input.onboarded ? copy.button.onboarded : copy.button.notOnboarded;
  const destination = emailLink(`${appUrl}${input.onboarded ? '/senders' : '/onboarding'}`, {
    template: 'sync_complete',
    mailboxId: input.mailboxAccountId,
  });
  const preferencesUrl = `${appUrl}/settings`;
  const footer = connectedFooter('this');
  const noun = input.messageCount === 1 ? 'email' : 'emails';

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
      <Text style={{ ...HERO_NUMERAL, margin: '0 0 4px' }}>{formatNumber(input.messageCount)}</Text>
      <Text style={{ color: SOFT, fontSize: '15px', lineHeight: '22px', margin: '0 0 22px' }}>
        {noun} scanned from{' '}
        <a
          href={`mailto:${input.mailboxEmail}`}
          style={{ color: INK, fontWeight: 600, textDecoration: 'none' }}
        >
          {input.mailboxEmail}
        </a>
        .
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>
        Your senders are grouped and ready to review.
      </Text>
      <Button href={destination} style={CTA_BUTTON}>
        {button}
      </Button>
    </Shell>,
  );

  return { subject: copy.subject, text, html };
}
