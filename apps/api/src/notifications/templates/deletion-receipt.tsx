import { Text } from '@react-email/components';

import { BODY_TEXT, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';

export interface DeletionReceiptEmailInput {
  /** Human-readable date the deletion completed, e.g. "June 18, 2026". */
  deletedAt: string;
}

const FOOTER = 'This receipt is the last email you will receive from us.';

/** D232 — sent after the deletion has executed (consumed by U22). */
export async function deletionReceiptEmail(
  input: DeletionReceiptEmailInput,
): Promise<RenderedEmail> {
  const text = [
    `On ${input.deletedAt}, DeclutrMail permanently deleted your account`,
    'and everything it stored about your mailboxes — sender names and',
    'addresses, subject lines, snippets, labels, and dates.',
    '',
    'Your Gmail account itself was never modified by this deletion.',
    '',
    'Thank you for trying DeclutrMail.',
    '',
    '— DeclutrMail',
    '',
    FOOTER,
  ].join('\n');

  // No CTA button — the account is gone; there is nowhere left to send them.
  const html = await renderShell(
    <Shell preview="Your DeclutrMail data has been deleted." footer={FOOTER}>
      <Eyebrow>Deleted {input.deletedAt}</Eyebrow>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        DeclutrMail permanently deleted your account and everything it stored about your mailboxes —
        sender names and addresses, subject lines, snippets, labels, and dates.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: '0 0 16px' }}>
        Your Gmail account itself was never modified by this deletion.
      </Text>
      <Text style={{ ...BODY_TEXT, margin: 0 }}>Thank you for trying DeclutrMail.</Text>
    </Shell>,
  );

  return { subject: 'Your DeclutrMail data has been deleted', text, html };
}
