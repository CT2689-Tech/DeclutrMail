/**
 * Transactional email templates (D162, D6, D232).
 *
 * Plain-text only — LOCKED. No react-email, no HTML, no marketing
 * chrome. Tone is the in-app calm/premium voice (Implementation-Plan
 * D126 Part 3: "calm/premium tone as in-app. Plain text only").
 *
 * Each template is a typed pure function `input → { subject, text }`,
 * snapshot-tested in `email-templates.spec.ts`.
 *
 * Privacy (D7, D228): templates carry COUNTS, DATES, the user's own
 * mailbox address, and DeclutrMail URLs — never message content, never
 * subjects or snippets of the user's mail, never other people's
 * addresses.
 */

/** Rendered email — what the EmailSendWorker job carries. */
export interface RenderedEmail {
  subject: string;
  text: string;
}

/**
 * The locked From header (D162). Domain `send.declutrmail.com` is
 * verified in Resend; the display name keeps inbox rows scannable.
 */
export const EMAIL_FROM = 'DeclutrMail <hello@send.declutrmail.com>';

export interface SyncCompleteEmailInput {
  /** The user's own connected mailbox address, e.g. "you@gmail.com". */
  mailboxEmail: string;
  /** Messages indexed by the initial sync (metadata only). */
  messageCount: number;
  /** Web app origin, e.g. "https://app.declutrmail.com". */
  appUrl: string;
}

/** D6 — sent when a mailbox's initial sync reaches `ready`. */
export function syncCompleteEmail(input: SyncCompleteEmailInput): RenderedEmail {
  const messages = formatCount(input.messageCount, 'message', 'messages');
  return {
    subject: 'Your inbox is ready',
    text: [
      `DeclutrMail finished indexing ${input.mailboxEmail}.`,
      '',
      `${messages} indexed — your senders are grouped and ready to`,
      'triage. The first pass usually takes a few minutes and clears',
      'the bulk of the noise.',
      '',
      `Jump back in: ${input.appUrl}/triage`,
      '(Still in setup? That link drops you right back where you left off.)',
      '',
      '— DeclutrMail',
      '',
      'You received this because you connected this mailbox to DeclutrMail.',
    ].join('\n'),
  };
}

export interface SyncReminderEmailInput {
  /** The user's own connected mailbox address. */
  mailboxEmail: string;
  /** Web app origin. */
  appUrl: string;
}

/**
 * D6 — the 24h nudge, sent only when the user has not returned since
 * the sync finished (the EmailSendWorker checks session activity at
 * execution time) and has not opted out of reminders (D165).
 */
export function syncReminder24hEmail(input: SyncReminderEmailInput): RenderedEmail {
  return {
    subject: 'Your inbox is still ready',
    text: [
      `Yesterday DeclutrMail finished indexing ${input.mailboxEmail}.`,
      '',
      'Your senders are grouped and waiting. Five minutes of triage is',
      'usually enough to feel the difference.',
      '',
      `Pick it up here: ${input.appUrl}/triage`,
      '',
      '— DeclutrMail',
      '',
      `You can turn off reminder emails at ${input.appUrl}/settings.`,
    ].join('\n'),
  };
}

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

/** D232 — sent when account deletion is scheduled (consumed by U22). */
export function deletionScheduledEmail(input: DeletionScheduledEmailInput): RenderedEmail {
  return {
    subject: 'Your DeclutrMail deletion is scheduled',
    text: [
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
      'This is a required account notice; it cannot be turned off.',
    ].join('\n'),
  };
}

export interface DeletionReceiptEmailInput {
  /** Human-readable date the deletion completed, e.g. "June 18, 2026". */
  deletedAt: string;
}

/** D232 — sent after the deletion has executed (consumed by U22). */
export function deletionReceiptEmail(input: DeletionReceiptEmailInput): RenderedEmail {
  return {
    subject: 'Your DeclutrMail data has been deleted',
    text: [
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
      'This receipt is the last email you will receive from us.',
    ].join('\n'),
  };
}

/** "1 message" / "24,310 messages" — en-US grouping, premium-calm. */
function formatCount(count: number, singular: string, plural: string): string {
  const formatted = new Intl.NumberFormat('en-US').format(count);
  return `${formatted} ${count === 1 ? singular : plural}`;
}
