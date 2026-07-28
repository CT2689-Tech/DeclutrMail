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
 * One-click unsubscribe (D165): UNSUBSCRIBE_TOKEN_SECRET is REQUIRED.
 * The smoke email carries both the RFC 8058 headers (Gmail's native
 * control) and the visible in-body link (CAN-SPAM/GDPR) — sending
 * without them would verify an artifact we do not ship. The token's
 * userId comes from SMOKE_UNSUBSCRIBE_USER_ID (the founder's prod user
 * id, for a full click→pref-flip check); without it a placeholder id
 * is signed — the control still renders and the click still reaches
 * the endpoint, which no-ops on the unknown user
 * (`email.unsubscribe.user_gone` in the API log).
 *
 *   pnpm --filter @declutrmail/api email-smoke
 */
import { Resend } from 'resend';

import { EMAIL_FROM, syncCompleteEmail } from '../src/notifications/templates/index.js';
import { unsubscribeHeadersFor, unsubscribeUrl } from '../src/notifications/unsubscribe-headers.js';

const TO = 'chintan.a.thakkar@gmail.com';

async function main(): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('email-smoke: RESEND_API_KEY is not set — aborting (fail-closed).');
    process.exit(1);
  }

  // Fail-closed on the signing secret too. The opt-out link is not
  // decoration: an email that ships without it is not the artifact this
  // smoke exists to verify, so sending one would be a false pass.
  if (!process.env.UNSUBSCRIBE_TOKEN_SECRET) {
    console.error(
      'email-smoke: UNSUBSCRIBE_TOKEN_SECRET is not set — aborting (fail-closed). ' +
        'The smoke email must carry a working unsubscribe link.',
    );
    process.exit(1);
  }

  const unsubscribe = await unsubscribeUrl({
    // Placeholder is uuid-SHAPED: verify rejects non-uuid userIds
    // (users.id is a uuid column), and the dead uuid keeps the
    // click on the documented `user_gone` no-op path.
    userId: process.env.SMOKE_UNSUBSCRIBE_USER_ID ?? '00000000-0000-4000-8000-00000000dead',
    scope: 'all',
    apiUrl: process.env.API_URL ?? 'https://api.declutrmail.com',
  });
  const headers = unsubscribeHeadersFor(unsubscribe);

  const rendered = await syncCompleteEmail({
    mailboxEmail: TO,
    messageCount: 12_345,
    appUrl: 'https://app.declutrmail.com',
    unsubscribeUrl: unsubscribe,
  });

  console.log(
    `email-smoke: unsubscribe wired, header + in-body link (userId=${
      process.env.SMOKE_UNSUBSCRIBE_USER_ID ? 'provided' : 'placeholder — click will no-op'
    })`,
  );

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send(
    {
      from: EMAIL_FROM,
      to: TO,
      subject: `[smoke] ${rendered.subject}`,
      text: rendered.text,
      // Multipart since D162 — the smoke proves the HTML twin renders
      // in a real client, not only that Resend accepted the call.
      ...(rendered.html === undefined ? {} : { html: rendered.html }),
      headers,
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
