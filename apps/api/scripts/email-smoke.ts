/**
 * Real-send smoke for the D162 transactional-email pipeline.
 *
 * Sends EXACTLY ONE sync-complete email to the founder through the
 * PRODUCTION artifacts — the real `syncCompleteEmail` template and the
 * real `EMAIL_FROM` constant — so the smoke exercises what ships, not
 * a parallel copy.
 *
 * Run by `.github/workflows/email-smoke.yml` (workflow_dispatch) with
 * RESEND_API_KEY from GH secrets. Never runs in CI automatically;
 * never imports app/db code (no DATABASE_URL needed).
 *
 *   pnpm --filter @declutrmail/api email-smoke
 */
import { Resend } from 'resend';

import { EMAIL_FROM, syncCompleteEmail } from '../src/notifications/email-templates.js';

const TO = 'chintan.a.thakkar@gmail.com';

async function main(): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('email-smoke: RESEND_API_KEY is not set — aborting (fail-closed).');
    process.exit(1);
  }

  const rendered = syncCompleteEmail({
    mailboxEmail: TO,
    messageCount: 12_345,
    appUrl: 'https://app.declutrmail.com',
  });

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to: TO,
      subject: `[smoke] ${rendered.subject}`,
      text: rendered.text,
    },
    // New key per run — the point IS to send one real email each run.
    { idempotencyKey: `email-smoke__${Date.now()}` },
  );

  if (error) {
    console.error(
      `email-smoke: FAILED code=${error.name} status=${error.statusCode ?? 'null'} message=${error.message}`,
    );
    process.exit(1);
  }
  console.log(`email-smoke: sent providerId=${data?.id ?? 'null'} to=${TO}`);
}

void main();
