'use client';

import { getActiveMailboxEmail, useOptionalAuth } from './auth-provider';
import { MailboxActionContextView } from './mailbox-action-context-view';

/**
 * Auth-reading wrapper — resolves the active mailbox, then delegates to
 * the presentational view. App surfaces use this; public surfaces import
 * the view directly and pass the mailbox (or nothing) themselves.
 */
export function MailboxActionContext({ mailboxEmail }: { mailboxEmail?: string | undefined }) {
  const auth = useOptionalAuth();
  const email = mailboxEmail ?? (auth ? getActiveMailboxEmail(auth.me) : null);

  return <MailboxActionContextView mailboxEmail={email ?? undefined} />;
}
