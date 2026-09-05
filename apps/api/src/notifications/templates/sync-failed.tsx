import { Button, Text } from '@react-email/components';

import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export interface SyncFailedEmailInput {
  /** The mailbox's own Gmail address — WHICH inbox stopped scanning. */
  mailboxEmail: string;
  /** Opaque target so another active mailbox cannot absorb the recovery link. */
  mailboxAccountId: string;
  /** Web app origin for the retry link (WEB_URL). */
  appUrl: string;
}

const FOOTER = 'This is a required account notice; it cannot be turned off.';

/**
 * D162 / D224 — sent when an initial inbox scan fails TERMINALLY
 * (worker retries exhausted, `readiness_status = 'failed'`).
 *
 * Before this email existed, a terminal failure was silent: the user
 * discovered it by sitting on the sync gate, and the gate's old copy
 * even promised an automatic retry that never came (first-run-trap
 * audit 2026-07-28). This notice states what actually happened and the
 * recovery route — reconnect Gmail or retry in the product. It promises no
 * automatic retry, because there isn't one.
 *
 * Classification: SYSTEM notice (account state, not marketing) — no
 * opt-out preference and exempt from the postal-address commercial
 * block, same footing as the deletion notices. No message content, no
 * counts beyond the mailbox's own address (D7/D228).
 */
export async function syncFailedEmail(input: SyncFailedEmailInput): Promise<RenderedEmail> {
  const retryUrl = `${input.appUrl}/onboarding?mailbox=${encodeURIComponent(input.mailboxAccountId)}`;

  const text = [
    `DeclutrMail could not finish scanning ${input.mailboxEmail}.`,
    '',
    'The scan could not continue and stopped. Nothing in your Gmail',
    'account was changed, and anything already scanned is kept — a',
    'retry picks up from there rather than starting over.',
    '',
    'We will not retry on our own. When you are ready, open the product',
    'to reconnect Gmail or try the scan again:',
    retryUrl,
    '',
    'If it fails again, reply to this email and a human will look.',
    '',
    '— DeclutrMail',
    '',
    FOOTER,
  ].join('\n');

  const html = await renderShell(
    <Shell
      preview={`The scan of ${input.mailboxEmail} stopped — retry when ready.`}
      footer={FOOTER}
    >
      <Eyebrow>Scan stopped</Eyebrow>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        DeclutrMail could not finish scanning <strong>{input.mailboxEmail}</strong>. The scan could
        not continue and stopped.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        Nothing in your Gmail account was changed, and anything already scanned is kept — a retry
        picks up from there rather than starting over.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>
        We will not retry on our own. When you are ready:
      </Text>
      <Button href={retryUrl} style={CTA_BUTTON}>
        Resume your scan
      </Button>
      <Text style={{ ...BODY_TEXT, margin: '26px 0 0' }}>
        If it fails again, reply to this email and a human will look.
      </Text>
    </Shell>,
  );

  return { subject: `We couldn't finish scanning ${input.mailboxEmail}`, text, html };
}
