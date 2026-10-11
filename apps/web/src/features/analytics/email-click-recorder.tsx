'use client';

import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { EMAIL_LINK_TEMPLATES } from '@declutrmail/shared/analytics/sanitize-product-event';

import { apiPost } from '@/lib/api/client';

const TEMPLATES = new Set<string>(EMAIL_LINK_TEMPLATES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Reads `from` / `mailbox` once, posts the click, then strips the params.
 * WS2b mounts this in the app chrome. The component renders nothing.
 */
export function EmailClickRecorder(): null {
  const params = useSearchParams();
  const router = useRouter();
  const posted = useRef(false);

  useEffect(() => {
    const from = params.get('from');
    if (!from || !TEMPLATES.has(from) || posted.current) return;
    posted.current = true;
    const mailbox = params.get('mailbox');
    const body: { template: string; mailboxId?: string } = { template: from };
    if (mailbox !== null && UUID.test(mailbox)) body.mailboxId = mailbox;
    void apiPost('/api/v1/analytics/email-click', body).catch(() => undefined);
    const next = new URLSearchParams(params.toString());
    next.delete('from');
    next.delete('mailbox');
    next.delete('utm_source');
    next.delete('utm_campaign');
    const query = next.toString();
    const path = typeof window === 'undefined' ? '/' : window.location.pathname;
    router.replace(query.length > 0 ? `${path}?${query}` : path);
  }, [params, router]);

  return null;
}
