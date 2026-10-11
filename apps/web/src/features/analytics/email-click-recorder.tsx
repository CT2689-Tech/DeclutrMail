'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { EMAIL_LINK_TEMPLATES } from '@declutrmail/shared/analytics/sanitize-product-event';

import { apiPost } from '@/lib/api/client';

const TEMPLATES = new Set<string>(EMAIL_LINK_TEMPLATES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAILBOX_HASH =
  /^#mailbox-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Settings links name the inbox in the hash. The resolver keys off `?mailbox=` only. */
function mailboxIdFromHash(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return MAILBOX_HASH.exec(window.location.hash)?.[1];
}

/**
 * Reads `from` once, posts the click, then strips the tracking params
 * this recorder owns (`from`, `utm_source`, `utm_campaign`). `mailbox`
 * stays: MailboxLinkResolver uses it to switch inboxes, and this
 * component often replaces the URL before that dynamic resolver mounts.
 * A reconnect link has no `mailbox` query; its id is `#mailbox-<uuid>`.
 * A second copy double-counts. The component renders nothing.
 */
export function EmailClickRecorder(): null {
  const params = useSearchParams();
  const router = useRouter();
  const posted = useRef(false);
  const captured = useRef<{ from: string; mailbox: string | null } | null>(null);
  if (!posted.current && captured.current === null) {
    const from = params.get('from');
    if (from && TEMPLATES.has(from)) {
      captured.current = { from, mailbox: params.get('mailbox') };
    }
  }

  useEffect(() => {
    const click = captured.current;
    if (!click || posted.current) return;
    posted.current = true;
    const body: { template: string; mailboxId?: string } = { template: click.from };
    const fromQuery =
      click.mailbox !== null && UUID.test(click.mailbox) ? click.mailbox : undefined;
    const mailboxId = fromQuery ?? mailboxIdFromHash();
    if (mailboxId !== undefined) body.mailboxId = mailboxId;
    void apiPost('/api/v1/analytics/email-click', body).catch(() => undefined);
    const next = new URLSearchParams(params.toString());
    next.delete('from');
    next.delete('utm_source');
    next.delete('utm_campaign');
    const query = next.toString();
    const path = typeof window === 'undefined' ? '/' : window.location.pathname;
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(`${path}${query.length > 0 ? `?${query}` : ''}${hash}`, { scroll: false });
  }, [params, router]);

  return null;
}
