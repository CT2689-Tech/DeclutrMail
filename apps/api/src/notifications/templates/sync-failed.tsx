import { Button, Text } from '@react-email/components';

import {
  fillWs4,
  SYNC_FAILED_NOTICE_WHILE_RETRYING,
  WS4_COPY,
} from '@declutrmail/shared/copy/launch';

import { emailLink } from './email-link.js';
import { syncFailedNotice, type SyncFailedNotice } from './sync-failed-reason.js';
import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export interface SyncFailedEmailInput {
  /** The mailbox's own Gmail address — WHICH inbox stopped scanning. */
  mailboxEmail: string;
  /** Opaque target so another active mailbox cannot absorb the recovery link. */
  mailboxAccountId: string;
  /** Web app origin for the retry link (WEB_URL). */
  appUrl: string;
  /** `provider_sync_state.error_code` / the sync_failed payload. */
  errorCode: string;
}

/**
 * D162 / D224 — sent when an initial inbox scan fails in a way the user
 * must hear about. Automatic recovery (up to 3 tries) runs BEFORE this
 * email. The notice is the needs-you, reconnect, or permanent variant.
 * The pending retrying sentence is not rendered.
 */
export async function syncFailedEmail(input: SyncFailedEmailInput): Promise<RenderedEmail> {
  const notice = syncFailedNotice(input.errorCode);
  const copy = WS4_COPY.email.syncFailed;
  const vars = { mailboxEmail: input.mailboxEmail };
  const retryUrl = emailLink(`${input.appUrl.replace(/\/$/, '')}/onboarding`, {
    template: 'sync_failed',
    mailboxId: input.mailboxAccountId,
  });
  const reason = reasonCopy(notice);
  const button = notice === 'needsReconnect' ? copy['button.reconnect'] : copy.button;
  const subject = fillWs4(copy.subject, vars);
  const preview = fillWs4(copy.preview, vars);
  const lead = fillWs4(copy.lead, vars);
  const footer = copy.footer;

  const text = [
    lead,
    '',
    copy.safe,
    '',
    reason,
    '',
    `${button}: ${retryUrl}`,
    '',
    '— DeclutrMail',
    '',
    footer,
  ].join('\n');

  const html = await renderShell(
    <Shell preview={preview} footer={footer}>
      <Eyebrow>{copy.eyebrow}</Eyebrow>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>{lead}</Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>{copy.safe}</Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 26px' }}>{reason}</Text>
      <Button href={retryUrl} style={CTA_BUTTON}>
        {button}
      </Button>
    </Shell>,
  );

  return { subject, text, html };
}

function reasonCopy(notice: SyncFailedNotice): string {
  if (SYNC_FAILED_NOTICE_WHILE_RETRYING) {
    return WS4_COPY.email.syncFailed.retrying;
  }
  switch (notice) {
    case 'needsYou':
      return WS4_COPY.email.syncFailed.needsYou;
    case 'needsReconnect':
      return WS4_COPY.email.syncFailed.needsReconnect;
    case 'permanent':
      return WS4_COPY.email.syncFailed.permanent;
    default: {
      const unreachable: never = notice;
      return unreachable;
    }
  }
}
