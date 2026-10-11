import type { RenderedEmail } from './shell.js';

/** Only aggregate facts may cross the email boundary. No Gmail content. */
export function briefReadyEmail(input: {
  runDateLocal: string;
  replySenders: number;
  fyiSenders: number;
  noiseEmails: number;
  mailboxAccountId: string;
  appUrl: string;
  unsubscribeUrl: string;
}): RenderedEmail {
  const briefUrl = `${input.appUrl}/brief?${new URLSearchParams({ mailbox: input.mailboxAccountId })}`;
  return {
    subject: 'Your daily Brief is ready',
    text: [
      `Your ${input.runDateLocal} Brief is ready in DeclutrMail.`,
      '',
      `Reply senders: ${input.replySenders}`,
      `FYI senders: ${input.fyiSenders}`,
      `Noise: ${input.noiseEmails} emails`,
      '',
      `Open this inbox’s Brief: ${briefUrl}`,
      '',
      'You enabled Daily Brief ready emails. Subjects and previews stay in the app.',
      `Unsubscribe: ${input.unsubscribeUrl}`,
      `Email preferences: ${input.appUrl}/settings#notifications`,
    ].join('\n'),
  };
}
