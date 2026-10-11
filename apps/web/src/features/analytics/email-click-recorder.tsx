'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { EMAIL_LINK_TEMPLATES } from '@declutrmail/shared/analytics/sanitize-product-event';

import { apiPost } from '@/lib/api/client';

const TEMPLATES = new Set<string>(EMAIL_LINK_TEMPLATES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads `from` / `mailbox` once, posts the click, then strips the params.
 * MailboxLinkBoundary mounts this outside the children the resolver
 * withholds, so `mailbox` is still on the URL. A second copy double-counts.
 * The component renders nothing.
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
    if (click.mailbox !== null && UUID.test(click.mailbox)) body.mailboxId = click.mailbox;
    void apiPost('/api/v1/analytics/email-click', body).catch(() => undefined);
    const next = new URLSearchParams(params.toString());
    next.delete('from');
    next.delete('mailbox');
    next.delete('utm_source');
    next.delete('utm_campaign');
    const query = next.toString();
    const path = typeof window === 'undefined' ? '/' : window.location.pathname;
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    router.replace(`${path}${query.length > 0 ? `?${query}` : ''}${hash}`, { scroll: false });
  }, [params, router]);

  return null;
}
