import { Button, Text } from '@react-email/components';
import type { BillingLifecycleChangedPayload } from '@declutrmail/events';
import type { TierId } from '@declutrmail/shared/entitlements';
import { BODY_TEXT, CTA_BUTTON, Eyebrow, renderShell, Shell, type RenderedEmail } from './shell.js';
export async function billingAccessEmail(input: {
  kind: BillingLifecycleChangedPayload['kind'];
  expectedAt: string | null;
  currentTier: TierId | null;
  billingUrl: string;
}): Promise<RenderedEmail> {
  const date = input.expectedAt
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(input.expectedAt)) + ' UTC'
    : null;
  const message =
    input.kind === 'cancellation'
      ? `Your subscription is scheduled to cancel${date ? ` on ${date}` : ''}. Billing shows your paid-through date and any complimentary access.`
      : input.kind === 'paused'
        ? `Your subscription is paused${date ? ` until ${date}` : ''}. Any other paid plan or complimentary grant is assessed separately.`
        : input.kind === 'grant_expiring'
          ? `Your complimentary access grant expires on ${date}. A paid plan or another complimentary grant may continue your access.`
          : input.kind === 'grant_expired'
            ? `Your complimentary access grant expired on ${date}. Other paid plans and complimentary grants continue according to Billing.`
            : `Your subscription access deadline is ${date ?? 'available in Billing'}. This notice describes app access; your payment provider confirms refunds and recurring billing.`;
  const access =
    input.currentTier === null
      ? 'Access verification is pending. Open Billing for the latest status.'
      : `Current app access: ${input.currentTier.charAt(0).toUpperCase() + input.currentTier.slice(1)}.`;
  const footer = 'This is an account access notice from DeclutrMail. Reply for help.';
  const subject =
    input.kind === 'grant_expiring'
      ? 'Your complimentary access expires soon'
      : input.kind === 'grant_expired'
        ? 'Your complimentary access grant expired'
        : 'Your DeclutrMail access update';
  const text = [
    message,
    '',
    access,
    '',
    `Review Billing: ${input.billingUrl}`,
    '',
    'Questions? Reply or email support@declutrmail.com.',
    '',
    footer,
  ].join('\n');
  const html = await renderShell(
    <Shell preview={subject} footer={footer}>
      <Eyebrow>Account access</Eyebrow>
      <Text style={BODY_TEXT}>{message}</Text>
      <Text style={BODY_TEXT}>{access}</Text>
      <Button href={input.billingUrl} style={CTA_BUTTON}>
        Review Billing
      </Button>
      <Text style={BODY_TEXT}>Questions? Reply or email support@declutrmail.com.</Text>
    </Shell>,
  );
  return { subject, text, html };
}
